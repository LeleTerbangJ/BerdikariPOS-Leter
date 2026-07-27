import { v4 as uuid } from 'uuid';
import type {
  Transaction,
  AtomicCheckoutParams,
  AtomicCheckoutResult,
  TransactionLifecycleState,
} from '../types';
import { InventoryEngine } from './inventoryEngine';
import { createSnapshotForCartItems } from '../utils/hpp';
import { formatRupiah } from '../utils/format';
import { useInventoryStore } from '../store/inventoryStore';
import { useTransactionStore } from '../store/transactionStore';
import { useMenuStore } from '../store/menuStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { printReceipt, buildReceiptFromTransaction } from '../utils/printer';
import { syncTransaction } from './cloudSync';

interface ProcessedRegistryEntry {
  state: TransactionLifecycleState;
  transaction?: Transaction;
  timestamp: string;
}

/**
 * ATOMIC TRANSACTION ENGINE (Enterprise POS Architecture)
 * 
 * Guarantees ACID-like transaction integrity for local-first POS:
 * 1. Strict Pre-checkout Validation (All-or-Nothing)
 * 2. Idempotency Protection (Prevents double submission / double deduction)
 * 3. Immutable Snapshot Recipe & Snapshot HPP Staging
 * 4. Local State Transaction Commit & Automatic Rollback Engine
 * 5. Isolated Post-Commit Asynchronous Sync & Print Tasks
 */
export class AtomicTransactionEngine {
  private static idempotencyRegistry = new Map<string, ProcessedRegistryEntry>();

  /**
   * Execute atomic checkout operation.
   */
  static async executeCheckout(params: AtomicCheckoutParams): Promise<AtomicCheckoutResult> {
    const txId = params.transactionId || uuid();

    // 1. Idempotency Check
    const existingEntry = this.idempotencyRegistry.get(txId);
    if (existingEntry) {
      if (
        existingEntry.state === 'COMMITTED' ||
        existingEntry.state === 'SYNC_PENDING' ||
        existingEntry.state === 'SYNCED'
      ) {
        return {
          success: true,
          transaction: existingEntry.transaction,
          idempotentReplay: true,
        };
      }
      if (existingEntry.state === 'VALIDATING' || existingEntry.state === 'PROCESSING') {
        return {
          success: false,
          error: 'Transaksi sedang diproses. Mohon tunggu sejenak.',
        };
      }
    }

    // Register PENDING state
    this.registerState(txId, 'PENDING');

    const menus = useMenuStore.getState().menus;
    const inventory = useInventoryStore.getState().items;

    // 2. Pre-checkout Inventory Validation (VALIDATING)
    this.registerState(txId, 'VALIDATING');
    const validation = InventoryEngine.validateStockAvailability(
      params.cartItems,
      menus,
      inventory
    );

    if (!validation.valid) {
      this.registerState(txId, 'FAILED');
      return {
        success: false,
        warnings: validation.warnings,
        error: 'Stok bahan baku tidak mencukupi untuk melakukan checkout.',
      };
    }

    // 3. Staging Snapshot Recipe & HPP (PROCESSING)
    this.registerState(txId, 'PROCESSING');
    const inventorySnapshot = InventoryEngine.captureSnapshot(inventory);

    try {
      const queueNum = await useTransactionStore.getState().getNextQueueNumber();
      const { itemsWithSnapshot, totalHpp } = createSnapshotForCartItems(
        params.cartItems,
        menus,
        inventory
      );

      const deductions = InventoryEngine.computeDeductions(itemsWithSnapshot, menus);
      const netSales = Math.max(0, params.subtotal - params.discount);
      const grossProfit = netSales - totalHpp;

      const tx: Transaction = {
        id: txId,
        queueNumber: queueNum,
        date: new Date().toISOString(),
        items: itemsWithSnapshot,
        subtotal: params.subtotal,
        discount: params.discount,
        tax: params.taxAmount,
        totalAmount: params.totalAmount,
        paymentMethod: params.payMethod,
        cashReceived: params.payMethod === 'Cash' ? params.cashReceived : undefined,
        change: params.payMethod === 'Cash' ? Math.max(0, (params.cashReceived || 0) - params.totalAmount) : undefined,
        kitchenStatus: 'Waiting',
        txStatus: 'Selesai',
        cashierId: params.currentUser?.id || '',
        cashierName: params.currentUser?.name || '',
        customerId: params.selectedCustomerId || undefined,
        customerName: params.selectedCustomerName || undefined,
        hpp: totalHpp,
        cogs: totalHpp,
        totalCogs: totalHpp,
        grossProfit: grossProfit,
        orderType: params.orderType,
        tableNumber:
          params.orderType === 'Dine In' && params.settings.tableFeaturesEnabled
            ? params.tableNumber
            : undefined,
        lifecycleState: 'COMMITTED',
      };

      // 4. Commit Local Mutations (COMMITTED)
      useInventoryStore.getState().deductStock(deductions, `Transaksi #${queueNum}`);
      useTransactionStore.getState().addTransaction(tx);

      if (params.currentUser) {
        useAuditLogStore.getState().addLog(
          params.currentUser.id,
          params.currentUser.name,
          params.currentUser.role as any,
          'create_transaction',
          `Transaksi #${queueNum} sebesar ${formatRupiah(params.totalAmount)} (Atomic Commit)`,
          { transactionId: tx.id, queueNumber: queueNum, total: params.totalAmount }
        );
      }

      this.registerState(txId, 'COMMITTED', tx);

      // 5. Post-Commit Asynchronous Isolation Tasks (SYNC_PENDING / SYNCED)
      this.triggerPostCommitTasks(tx, params);

      return {
        success: true,
        transaction: tx,
      };
    } catch (err: any) {
      // ROLLBACK ENGINE
      console.error('[AtomicEngine] Transaction failed during processing, rolling back:', err);
      this.executeRollback(txId, inventorySnapshot);
      return {
        success: false,
        error: err.message || 'Gagal memproses transaksi. Perubahan telah dibatalkan.',
      };
    }
  }

  /**
   * Rollback local state mutations using inventory snapshot.
   */
  private static executeRollback(txId: string, inventorySnapshot: Map<string, number>) {
    try {
      // 1. Restore Inventory
      const inventoryStore = useInventoryStore.getState();
      inventorySnapshot.forEach((originalStock, invId) => {
        inventoryStore.updateItem(invId, { stock: originalStock }, { skipLog: true });
      });

      // 2. Remove Staged Transaction if present
      const txStore = useTransactionStore.getState();
      const existingTx = txStore.transactions.find((t) => t.id === txId);
      if (existingTx) {
        txStore.deleteTransaction(txId);
      }

      this.registerState(txId, 'ROLLED_BACK');
      console.log(`[AtomicEngine] Rollback executed successfully for Tx #${txId}`);
    } catch (rollbackErr) {
      console.error('[AtomicEngine] Critical error during rollback execution:', rollbackErr);
    }
  }

  /**
   * Run Cloud Sync and Printing asynchronously after Commit.
   * Printer offline or network failure MUST NOT invalidate the committed transaction.
   */
  private static async triggerPostCommitTasks(tx: Transaction, params: AtomicCheckoutParams) {
    this.registerState(tx.id, 'SYNC_PENDING', tx);

    // Asynchronous Cloud Sync
    try {
      await syncTransaction(tx);
      this.registerState(tx.id, 'SYNCED', tx);
    } catch (e) {
      console.warn('[AtomicEngine] Post-commit cloud sync warning (queued offline):', e);
    }

    // Asynchronous Printing
    try {
      if (params.settings.printerEnabled || params.settings.autoPrintOnCheckout) {
        const receiptData = buildReceiptFromTransaction(tx, params.settings);
        printReceipt(receiptData, params.settings, 'all', params.preOpenedPrintWindow || undefined);
      }
    } catch (printErr) {
      console.warn('[AtomicEngine] Post-commit printer warning:', printErr);
    }
  }

  private static registerState(
    txId: string,
    state: TransactionLifecycleState,
    transaction?: Transaction
  ) {
    this.idempotencyRegistry.set(txId, {
      state,
      transaction,
      timestamp: new Date().toISOString(),
    });
  }
}
