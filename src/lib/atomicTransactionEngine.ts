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
import { syncTransaction, deleteTransactionCloud } from './cloudSync';
import {
  pruneIdempotencyEntries,
  IDEMPOTENCY_TTL_MS,
  MAX_IDEMPOTENCY_ENTRIES,
  type ProcessedRegistryEntry,
} from '../utils/idempotencyCleanup';

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
  private static registerStateCalls = 0;

  /**
   * Execute atomic checkout operation.
   */
  static async executeCheckout(params: AtomicCheckoutParams): Promise<AtomicCheckoutResult> {
    const txId = params.transactionId || uuid();

    // 1. Idempotency Check
    const existingEntry = this.idempotencyRegistry.get(txId);
    if (existingEntry) {
      // In-flight guard: mencegah double-submit saat transaksi masih diproses (berlaku untuk SEMUA alur)
      if (existingEntry.state === 'VALIDATING' || existingEntry.state === 'PROCESSING') {
        return {
          success: false,
          error: 'Transaksi sedang diproses. Mohon tunggu sejenak.',
        };
      }
      if (params.bypassIdempotency) {
        // Resume/update/finalize pending: re-commit dengan ID yang sama DIIZINKAN,
        // kecuali transaksi sudah berstatus 'Selesai' (sudah dilunasi) → tolak replay (anti double-pay).
        if (
          (existingEntry.state === 'COMMITTED' ||
            existingEntry.state === 'SYNC_PENDING' ||
            existingEntry.state === 'SYNCED') &&
          existingEntry.transaction?.txStatus === 'Selesai'
        ) {
          return {
            success: true,
            transaction: existingEntry.transaction,
            idempotentReplay: true,
          };
        }
      } else if (
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
    }

    // Guard: keranjang kosong tidak boleh diproses.
    // Mencegah race re-commit kosong (misal double-click update pending setelah cart.clearCart())
    // yang bisa salah me-revert stok reserve / membuat transaksi kosong.
    if (!params.cartItems || params.cartItems.length === 0) {
      return {
        success: false,
        error: 'Keranjang kosong. Tidak ada item untuk diproses.',
      };
    }

    // Register PENDING state
    this.registerState(txId, 'PENDING');

    const menus = useMenuStore.getState().menus;
    const inventory = useInventoryStore.getState().items;

    // 2. Pre-checkout Inventory Validation (VALIDATING)
    this.registerState(txId, 'VALIDATING');
    // Resume Pending: stok efektif = stok saat ini + stok yang sudah di-reserve oleh pesanan pending.
    // Tanpa ini, validasi akan salah gagal karena stok sudah berkurang akibat reservasi awal.
    const effectiveInventory = params.reservedDeductions
      ? inventory.map((i) => ({ ...i, stock: i.stock + (params.reservedDeductions![i.id] || 0) }))
      : inventory;
    const validation = InventoryEngine.validateStockAvailability(
      params.cartItems,
      menus,
      effectiveInventory
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
      const queueNum = params.overrideQueueNumber || (await useTransactionStore.getState().getNextQueueNumber());
      const { itemsWithSnapshot, totalHpp } = createSnapshotForCartItems(
        params.cartItems,
        menus,
        inventory
      );

      const deductions = InventoryEngine.computeDeductions(itemsWithSnapshot, menus);
      // v4.5 TO DO 5.2: scaleHpp — sub-bill split mode Equal membawa SEMUA item cart sehingga
      // totalHpp snapshot = HPP penuh per sub-bill. Skala agar Σ hpp sub-bill === HPP induk
      // (laba kotor & margin tidak ter-inflasi N× di Reports/Dashboard).
      const scaledHpp = Math.round(totalHpp * (params.scaleHpp ?? 1));
      const netSales = Math.max(0, params.subtotal - params.discount);
      const grossProfit = netSales - scaledHpp;
      const targetTxStatus = params.overrideTxStatus || 'Selesai';

      const tx: Transaction = {
        id: txId,
        queueNumber: queueNum,
        date: new Date().toISOString(),
        // v4.7 (evaluasi updatedAt): stamp mutasi terakhir tiap commit — loadFromCloud
        // memakai ini (fallback date) agar update lokal yang belum tersync tidak ditimpa
        // data cloud stale (race realtime/refresh). `date` sendiri dipakai laporan & filter.
        updatedAt: new Date().toISOString(),
        items: itemsWithSnapshot,
        subtotal: params.subtotal,
        discount: params.discount,
        tax: params.taxAmount,
        totalAmount: params.totalAmount,
        paymentMethod: params.payMethod,
        cashReceived: params.payMethod === 'Cash' ? params.cashReceived : undefined,
        change: params.payMethod === 'Cash' ? Math.max(0, (params.cashReceived || 0) - params.totalAmount) : undefined,
        kitchenStatus: params.overrideKitchenStatus || 'Waiting',
        txStatus: targetTxStatus,
        cashierId: params.currentUser?.id || '',
        cashierName: params.currentUser?.name || '',
        customerId: params.selectedCustomerId || undefined,
        customerName: params.selectedCustomerName || undefined,
        hpp: scaledHpp,
        cogs: scaledHpp,
        totalCogs: scaledHpp,
        grossProfit: grossProfit,
        orderType: params.orderType,
        tableNumber:
          params.orderType === 'Dine In' && params.settings.tableFeaturesEnabled
            ? params.tableNumber
            : undefined,
        tableName: params.tableNumber || undefined,
        isPending: targetTxStatus === 'Pending',
        pendingNotes: params.pendingNotes,
        splitParentId: params.splitParentId,
        splitIndex: params.splitIndex,
        totalSplitCount: params.totalSplitCount,
        // v4.5 TO DO 5.5: rekam promo/voucher pada transaksi pending agar bisa di-restore saat resume
        appliedPromoId: params.appliedPromoId,
        voucherCode: params.voucherCode,
        // v4.7 TO DO 12.2.4 (P-A3): snapshot nama & nominal diskon promo untuk laporan performa promo
        promoName: params.promoName,
        promoAmount: params.promoAmount,
        lifecycleState: 'COMMITTED',
      };

      // 4. Commit Local Mutations (COMMITTED)
      if (params.skipStockDeduction) {
        // Reserved stock sudah menutupi transaksi ini (contoh: sub-bill split dari pesanan pending)
      } else if (params.reservedDeductions) {
        // Resume/update/finalize pending: deduksi DELTA antara cart baru vs stok yang sudah di-reserve.
        // Item baru → potong stok; item yang dihapus → kembalikan stok (revert).
        const deltaDeduct: Record<string, number> = {};
        const deltaRevert: Record<string, number> = {};
        for (const [invId, needed] of Object.entries(deductions)) {
          const reserved = params.reservedDeductions[invId] || 0;
          const diff = needed - reserved;
          if (diff > 0) deltaDeduct[invId] = diff;
          else if (diff < 0) deltaRevert[invId] = -diff;
        }
        // Bahan yang di-reserve tapi tidak lagi dibutuhkan di cart baru → kembalikan seluruhnya
        for (const [invId, reserved] of Object.entries(params.reservedDeductions)) {
          if (!(invId in deductions) && reserved > 0) {
            deltaRevert[invId] = (deltaRevert[invId] || 0) + reserved;
          }
        }
        if (Object.keys(deltaDeduct).length > 0) {
          useInventoryStore.getState().deductStock(deltaDeduct, `Transaksi #${queueNum} (Delta Pending)`);
        }
        if (Object.keys(deltaRevert).length > 0) {
          useInventoryStore.getState().revertStock(deltaRevert, `Transaksi #${queueNum} (Koreksi Pending)`);
        }
      } else {
        useInventoryStore.getState().deductStock(deductions, `Transaksi #${queueNum}`);
      }
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
      await this.executeRollback(txId, inventorySnapshot);
      return {
        success: false,
        error: err.message || 'Gagal memproses transaksi. Perubahan telah dibatalkan.',
      };
    }
  }

  /**
   * Rollback local state mutations using inventory snapshot.
   * v4.5 TO DO 6.5: rollback kini await penghapusan cloud + tombstone lokal (anti ghost) —
   * sebelumnya deleteTransactionCloud fire-and-forget → baris cloud bisa tersisa → transaksi
   * yang "gagal" muncul lagi setelah reload / device lain via loadFromCloud.
   */
  private static async executeRollback(txId: string, inventorySnapshot: Map<string, number>) {
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
        // deleteTransaction: hapus lokal + tombstone (anti ghost) + fire cloud delete
        txStore.deleteTransaction(txId);
        // PASTIKAN penghapusan cloud selesai sebelum rollback dianggap sukses
        // (jika offline, smartDelete masuk offline queue → ter-flush saat online).
        try {
          await deleteTransactionCloud(txId);
        } catch (e) {
          console.warn('[AtomicEngine] Gagal menghapus transaksi dari cloud saat rollback (masuk antrean offline):', e);
        }
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
    // suppressAutoPrint (v4.1 TO DO 1.5): sub-bill split mengelola print sendiri (printSplitReceipt),
    // sehingga engine tidak boleh mencetak struk + tiket dapur berulang per sub-bill.
    // v4.7 TO DO 15.3: dua toggle independen — skipReceiptPrint (struk kasir dilewati, tiket dapur
    // tetap bisa keluar) & skipKitchenPrint (tiket dapur dilewati — anti tiket DOBEL saat resume
    // pending yang tiket dapurnya sudah tercetak saat Simpan Pending). Keduanya false → normal.
    if (!params.suppressAutoPrint) {
      try {
        if (params.settings.printerEnabled || params.settings.autoPrintOnCheckout) {
          const receiptData = buildReceiptFromTransaction(tx, params.settings);
          // 1. Struk kasir — dilewati bila skipReceiptPrint
          if (!params.skipReceiptPrint) {
            printReceipt(receiptData, params.settings, 'cashier', params.preOpenedPrintWindow || undefined);
          }
          // 2. Tiket dapur — dilewati bila skipKitchenPrint
          if (!params.skipKitchenPrint) {
            printReceipt(receiptData, params.settings, 'kitchen');
          }
        }
      } catch (printErr) {
        console.warn('[AtomicEngine] Post-commit printer warning:', printErr);
      }
    }
  }

  private static registerState(
    txId: string,
    state: TransactionLifecycleState,
    transaction?: Transaction
  ) {
    // v4.1 TO DO 2.4: cleanup amortized (tiap 50 panggilan atau saat mendekati batas ukuran)
    this.cleanupIdempotencyRegistry();
    this.idempotencyRegistry.set(txId, {
      state,
      transaction,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * v4.1 TO DO 2.4 — Bersihkan idempotency registry (TTL 24 jam + batas 1000 entry)
   * agar memori tidak tumbuh tanpa batas di sesi kasir yang panjang.
   * Throttle: sweep hanya tiap 50 panggilan, atau saat ukuran MELAMPAUI batas (size > MAX).
   * Setelah prune, ukuran tepat = MAX sehingga throttle kembali normal (tidak sort tiap panggilan).
   */
  private static cleanupIdempotencyRegistry() {
    this.registerStateCalls++;
    if (
      this.registerStateCalls % 50 !== 0 &&
      this.idempotencyRegistry.size <= MAX_IDEMPOTENCY_ENTRIES
    ) {
      return;
    }
    pruneIdempotencyEntries(this.idempotencyRegistry, Date.now());
  }
}
