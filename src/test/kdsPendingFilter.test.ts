import { describe, it, expect } from 'vitest';
import type { Transaction } from '../types';

function filterKdsActiveOrders(transactions: Transaction[], todayStr: string): Transaction[] {
  const today = new Date(todayStr);
  today.setHours(0, 0, 0, 0);

  return transactions.filter((t) => {
    if (t.txStatus !== 'Selesai' && t.txStatus !== 'Pending') return false;
    // v4.8: Pesanan pending yang disimpan dengan "Simpan Tanpa Cetak" (kitchenTicketPrintedAt belum terisi)
    // TIDAK boleh muncul di KDS. KDS hanya menampilkan pesanan pending yang dicetak ke dapur.
    if (t.txStatus === 'Pending' && !t.kitchenTicketPrintedAt) return false;
    if (t.splitParentId || (t.splitIndex !== undefined && !t.splitParentId)) return false;
    if (new Date(t.date) < today) return false;
    return true;
  });
}

describe('KDS Pending Print Option Filter (v4.8)', () => {
  const nowStr = new Date().toISOString();

  it('pesanan pending yang disimpan dengan "Simpan Tanpa Cetak" (kitchenTicketPrintedAt undefined) TIDAK muncul di KDS', () => {
    const pendingNoPrint: Transaction = {
      id: 'tx-1',
      queueNumber: 1,
      date: nowStr,
      items: [],
      subtotal: 10000,
      discount: 0,
      totalAmount: 10000,
      hpp: 0,
      tax: 0,
      orderType: 'Dine In',
      paymentMethod: 'Cash',
      kitchenStatus: 'Waiting',
      txStatus: 'Pending',
      cashierId: 'c1',
      cashierName: 'Kasir',
      // kitchenTicketPrintedAt undefined
    };

    const res = filterKdsActiveOrders([pendingNoPrint], nowStr);
    expect(res).toHaveLength(0);
  });

  it('pesanan pending yang disimpan dengan "Cetak Dapur Saja" (kitchenTicketPrintedAt terisi) MUNCUL di KDS', () => {
    const pendingWithKitchenPrint: Transaction = {
      id: 'tx-2',
      queueNumber: 2,
      date: nowStr,
      items: [],
      subtotal: 15000,
      discount: 0,
      totalAmount: 15000,
      hpp: 0,
      tax: 0,
      orderType: 'Dine In',
      paymentMethod: 'Cash',
      kitchenStatus: 'Waiting',
      txStatus: 'Pending',
      cashierId: 'c1',
      cashierName: 'Kasir',
      kitchenTicketPrintedAt: nowStr,
    };

    const res = filterKdsActiveOrders([pendingWithKitchenPrint], nowStr);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('tx-2');
  });

  it('pesanan yang sudah lunas (txStatus === Selesai) MUNCUL di KDS meskipun tanpa kitchenTicketPrintedAt', () => {
    const completedTx: Transaction = {
      id: 'tx-3',
      queueNumber: 3,
      date: nowStr,
      items: [],
      subtotal: 20000,
      discount: 0,
      totalAmount: 20000,
      hpp: 0,
      tax: 0,
      orderType: 'Dine In',
      paymentMethod: 'Cash',
      kitchenStatus: 'Waiting',
      txStatus: 'Selesai',
      cashierId: 'c1',
      cashierName: 'Kasir',
    };

    const res = filterKdsActiveOrders([completedTx], nowStr);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('tx-3');
  });
});
