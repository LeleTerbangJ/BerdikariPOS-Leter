import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mapCloudRowToTransaction } from '../lib/cloudSync';
import { useTransactionStore } from '../store/transactionStore';
import { useStockLogStore } from '../store/stockLogStore';
import type { Transaction } from '../types';

describe('Realtime Direct Ingestion & Safety Guards (v4.9.2)', () => {
  beforeEach(() => {
    useTransactionStore.setState({
      transactions: [],
      nextQueueNumber: 1,
      lastQueueDate: null,
      deletedLocalIds: [],
      confirmedSyncIds: [],
    });
    useStockLogStore.setState({ logs: [] });
  });

  describe('mapCloudRowToTransaction', () => {
    it('mengonversi seluruh baris snake_case dari Supabase ke model Transaction camelCase', () => {
      const rawDbRow = {
        id: 'tx-100',
        queue_number: 15,
        date: '2026-08-21T12:00:00.000Z',
        items: [
          { lineId: 'l1', name: 'PH Lele Terbang', quantity: 2, batch: 1, kitchenItemStatus: 'done' },
        ],
        subtotal: 40000,
        discount: 5000,
        total_amount: 35000,
        payment_method: 'QRIS',
        cash_received: 35000,
        change: 0,
        kitchen_status: 'Waiting',
        tx_status: 'Pending',
        cashier_id: 'usr-1',
        cashier_name: 'Budi Kasir',
        customer_id: 'cust-1',
        customer_name: 'Pak Joko',
        hpp: 20000,
        tax: 0,
        order_type: 'Dine In',
        table_number: 'Meja 5',
        table_name: 'Meja 5',
        refunded: false,
        refunded_at: null,
        refunded_amount: null,
        refund_note: null,
        refunded_by_id: null,
        refunded_by_name: null,
        pending_notes: 'Pesanan Gantung',
        split_parent_id: null,
        split_index: null,
        total_split_count: null,
        paid_amount: null,
        applied_promo_id: 'promo-1',
        voucher_code: 'DISKON5K',
        promo_name: 'Promo Merdeka',
        promo_amount: 5000,
        kitchen_ticket_printed_at: '2026-08-21T12:00:05.000Z',
        updated_at: '2026-08-21T12:01:00.000Z',
      };

      const mapped = mapCloudRowToTransaction(rawDbRow);

      expect(mapped.id).toBe('tx-100');
      expect(mapped.queueNumber).toBe(15);
      expect(mapped.date).toBe('2026-08-21T12:00:00.000Z');
      expect(mapped.items).toHaveLength(1);
      expect(mapped.items[0].name).toBe('PH Lele Terbang');
      expect(mapped.items[0].kitchenItemStatus).toBe('done');
      expect(mapped.subtotal).toBe(40000);
      expect(mapped.discount).toBe(5000);
      expect(mapped.totalAmount).toBe(35000);
      expect(mapped.paymentMethod).toBe('QRIS');
      expect(mapped.kitchenStatus).toBe('Waiting');
      expect(mapped.txStatus).toBe('Pending');
      expect(mapped.isPending).toBe(true);
      expect(mapped.cashierName).toBe('Budi Kasir');
      expect(mapped.customerName).toBe('Pak Joko');
      expect(mapped.orderType).toBe('Dine In');
      expect(mapped.tableNumber).toBe('Meja 5');
      expect(mapped.appliedPromoId).toBe('promo-1');
      expect(mapped.voucherCode).toBe('DISKON5K');
      expect(mapped.promoName).toBe('Promo Merdeka');
      expect(mapped.promoAmount).toBe(5000);
      expect(mapped.kitchenTicketPrintedAt).toBe('2026-08-21T12:00:05.000Z');
      expect(mapped.updatedAt).toBe('2026-08-21T12:01:00.000Z');
    });
  });

  describe('upsertTransactionFromRealtime', () => {
    it('memasukkan transaksi baru langsung ke state lokal secara instan & memperbarui nextQueueNumber', () => {
      const nowIso = new Date().toISOString();
      const tx: Transaction = {
        id: 'tx-201',
        queueNumber: 7,
        date: nowIso,
        items: [],
        subtotal: 20000,
        discount: 0,
        totalAmount: 20000,
        paymentMethod: 'Cash',
        kitchenStatus: 'Waiting',
        txStatus: 'Pending',
        cashierId: 'c1',
        cashierName: 'Kasir',
        hpp: 10000,
        tax: 0,
        updatedAt: nowIso,
      };

      useTransactionStore.getState().upsertTransactionFromRealtime(tx);

      const state = useTransactionStore.getState();
      expect(state.transactions).toHaveLength(1);
      expect(state.transactions[0].id).toBe('tx-201');
      expect(state.nextQueueNumber).toBe(8);
      expect(state.confirmedSyncIds).toContain('tx-201');
    });

    it('memperbarui transaksi yang sudah ada jika sinyal cloud memiliki updatedAt lebih baru', () => {
      const initialTx: Transaction = {
        id: 'tx-202',
        queueNumber: 8,
        date: '2026-08-21T10:00:00.000Z',
        items: [{ lineId: 'l1', menuId: 'm1', name: 'PH Lele', quantity: 1, basePrice: 20000, temperature: 'Dingin', sugar: 'Normal', addons: [], subtotal: 20000, kitchenItemStatus: 'new' }],
        subtotal: 20000,
        discount: 0,
        totalAmount: 20000,
        paymentMethod: 'Cash',
        kitchenStatus: 'Waiting',
        txStatus: 'Pending',
        cashierId: 'c1',
        cashierName: 'Kasir',
        hpp: 10000,
        tax: 0,
        updatedAt: '2026-08-21T10:00:00.000Z',
      };

      useTransactionStore.setState({ transactions: [initialTx] });

      const updatedCloudTx: Transaction = {
        ...initialTx,
        kitchenStatus: 'Done',
        items: [{ lineId: 'l1', menuId: 'm1', name: 'PH Lele', quantity: 1, basePrice: 20000, temperature: 'Dingin', sugar: 'Normal', addons: [], subtotal: 20000, kitchenItemStatus: 'done' }],
        updatedAt: '2026-08-21T10:05:00.000Z',
      };

      useTransactionStore.getState().upsertTransactionFromRealtime(updatedCloudTx);

      const state = useTransactionStore.getState();
      expect(state.transactions).toHaveLength(1);
      expect(state.transactions[0].kitchenStatus).toBe('Done');
      expect(state.transactions[0].items[0].kitchenItemStatus).toBe('done');
    });

    it('LWW Guard: menolak menimpa data lokal jika versi lokal lebih baru dari sinyal realtime yang terlambat', () => {
      const newerLocalTx: Transaction = {
        id: 'tx-203',
        queueNumber: 9,
        date: '2026-08-21T10:00:00.000Z',
        items: [{ lineId: 'l1', menuId: 'm1', name: 'PH Lele', quantity: 1, basePrice: 20000, temperature: 'Dingin', sugar: 'Normal', addons: [], subtotal: 20000, kitchenItemStatus: 'done' }],
        subtotal: 20000,
        discount: 0,
        totalAmount: 20000,
        paymentMethod: 'Cash',
        kitchenStatus: 'Done',
        txStatus: 'Selesai',
        cashierId: 'c1',
        cashierName: 'Kasir',
        hpp: 10000,
        tax: 0,
        updatedAt: '2026-08-21T10:10:00.000Z',
      };

      useTransactionStore.setState({ transactions: [newerLocalTx] });

      // Sinyal WebSocket terlambat (timestamp 10:05 < 10:10)
      const olderCloudTx: Transaction = {
        ...newerLocalTx,
        kitchenStatus: 'Waiting',
        txStatus: 'Pending',
        updatedAt: '2026-08-21T10:05:00.000Z',
      };

      useTransactionStore.getState().upsertTransactionFromRealtime(olderCloudTx);

      const state = useTransactionStore.getState();
      expect(state.transactions).toHaveLength(1);
      expect(state.transactions[0].kitchenStatus).toBe('Done');
      expect(state.transactions[0].txStatus).toBe('Selesai');
    });

    it('Tombstone Guard: menolak membangkitkan transaksi yang ada di deletedLocalIds (anti-ghost)', () => {
      useTransactionStore.setState({
        transactions: [],
        deletedLocalIds: ['tx-deleted-999'],
      });

      const resurrectedTx: Transaction = {
        id: 'tx-deleted-999',
        queueNumber: 10,
        date: new Date().toISOString(),
        items: [],
        subtotal: 10000,
        discount: 0,
        totalAmount: 10000,
        paymentMethod: 'Cash',
        kitchenStatus: 'Waiting',
        txStatus: 'Pending',
        cashierId: 'c1',
        cashierName: 'Kasir',
        hpp: 5000,
        tax: 0,
      };

      useTransactionStore.getState().upsertTransactionFromRealtime(resurrectedTx);

      const state = useTransactionStore.getState();
      expect(state.transactions).toHaveLength(0);
    });
  });

  describe('addLogsBulk in stockLogStore', () => {
    it('mencatat banyak entri log stok sekaligus ke dalam state', () => {
      const logs = [
        {
          id: 'log-1',
          inventoryId: 'inv-1',
          inventoryName: 'Beras',
          type: 'deduct' as const,
          amount: -2,
          stockBefore: 10,
          stockAfter: 8,
          unit: 'kg',
          date: new Date().toISOString(),
        },
        {
          id: 'log-2',
          inventoryId: 'inv-2',
          inventoryName: 'Minyak',
          type: 'deduct' as const,
          amount: -1,
          stockBefore: 5,
          stockAfter: 4,
          unit: 'liter',
          date: new Date().toISOString(),
        },
      ];

      useStockLogStore.getState().addLogsBulk(logs);

      const state = useStockLogStore.getState();
      expect(state.logs).toHaveLength(2);
      expect(state.logs.map((l) => l.id)).toEqual(['log-1', 'log-2']);
    });
  });
});
