import { describe, it, expect } from 'vitest';
import { computeShiftStats, EMPTY_SHIFT_STATS } from '../utils/shiftStats';
import type { CashierShift, Transaction, CashMovement } from '../types';

const openedAt = '2026-08-18T09:00:00.000Z';

const shift: CashierShift = {
  id: 'shift-1',
  userId: 'u1',
  userName: 'Kasir 1',
  openedAt,
  openingCash: 200000,
  totalSales: 0,
  totalTransactions: 0,
  status: 'open',
};

const tx = (over: Partial<Transaction> & { id: string; date: string }): Transaction => ({
  queueNumber: 1,
  items: [],
  subtotal: 0,
  discount: 0,
  totalAmount: 0,
  paymentMethod: 'Cash',
  kitchenStatus: 'Done',
  txStatus: 'Selesai',
  cashierId: 'u1',
  cashierName: 'Kasir 1',
  hpp: 0,
  ...over,
});

const mv = (over: Partial<CashMovement> & { id: string; date: string }): CashMovement => ({
  type: 'in',
  amount: 0,
  category: 'Lain-lain',
  cashierId: 'u1',
  cashierName: 'Kasir 1',
  createdAt: over.date,
  ...over,
});

describe('computeShiftStats — v4.7 TO DO 18.3 (1 shift per outlet, data tersinkron)', () => {
  it('menghitung expected cash = modal awal + tunai + kas masuk - kas keluar', () => {
    const stats = computeShiftStats(shift, [
      tx({ id: 't1', date: '2026-08-18T10:00:00.000Z', totalAmount: 50000, paymentMethod: 'Cash' }),
      tx({ id: 't2', date: '2026-08-18T11:00:00.000Z', totalAmount: 30000, paymentMethod: 'Cash' }),
      tx({ id: 't3', date: '2026-08-18T12:00:00.000Z', totalAmount: 70000, paymentMethod: 'QRIS' }),
    ], [
      mv({ id: 'm1', date: '2026-08-18T10:30:00.000Z', type: 'in', amount: 50000 }),
      mv({ id: 'm2', date: '2026-08-18T11:30:00.000Z', type: 'out', amount: 10000 }),
    ]);

    expect(stats.totalSales).toBe(150000);
    expect(stats.totalTx).toBe(3);
    expect(stats.cashSales).toBe(80000);
    expect(stats.qrisSales).toBe(70000);
    expect(stats.transferSales).toBe(0);
    expect(stats.cashIn).toBe(50000);
    expect(stats.cashOut).toBe(10000);
    expect(stats.expectedCash).toBe(200000 + 80000 + 50000 - 10000);
  });

  it('menghitung SEMUA kasir (bukan hanya kasir device ini) — transaksi kasir lain ikut', () => {
    const stats = computeShiftStats(shift, [
      tx({ id: 't1', date: '2026-08-18T10:00:00.000Z', totalAmount: 50000, paymentMethod: 'Cash', cashierId: 'u1', cashierName: 'Kasir 1' }),
      tx({ id: 't2', date: '2026-08-18T10:30:00.000Z', totalAmount: 25000, paymentMethod: 'Cash', cashierId: 'u2', cashierName: 'Kasir 2' }),
    ], []);

    expect(stats.totalSales).toBe(75000);
    expect(stats.cashSales).toBe(75000);
    expect(stats.expectedCash).toBe(200000 + 75000);
  });

  it('mengabaikan transaksi bukan Selesai (Pending/Cancel/Demo) dan sub-bill split', () => {
    const stats = computeShiftStats(shift, [
      tx({ id: 't1', date: '2026-08-18T10:00:00.000Z', totalAmount: 50000, paymentMethod: 'Cash' }),
      tx({ id: 't2', date: '2026-08-18T10:05:00.000Z', totalAmount: 99999, paymentMethod: 'Cash', txStatus: 'Pending' }),
      tx({ id: 't3', date: '2026-08-18T10:10:00.000Z', totalAmount: 99999, paymentMethod: 'Cash', txStatus: 'Cancel' }),
      tx({ id: 't4', date: '2026-08-18T10:15:00.000Z', totalAmount: 99999, paymentMethod: 'Cash', txStatus: 'Demo' }),
      tx({ id: 't5', date: '2026-08-18T10:20:00.000Z', totalAmount: 99999, paymentMethod: 'Cash', splitParentId: 'parent-1' }),
    ], []);

    expect(stats.totalSales).toBe(50000);
    expect(stats.totalTx).toBe(1);
    expect(stats.expectedCash).toBe(200000 + 50000);
  });

  it('mengabaikan transaksi sebelum shift dibuka', () => {
    const stats = computeShiftStats(shift, [
      tx({ id: 't1', date: '2026-08-18T08:00:00.000Z', totalAmount: 99999, paymentMethod: 'Cash' }),
      tx({ id: 't2', date: '2026-08-18T09:00:00.000Z', totalAmount: 20000, paymentMethod: 'Cash' }),
    ], []);

    expect(stats.totalSales).toBe(20000);
  });

  it('Kas Masuk/Keluar: shiftId match diutamakan, fallback window waktu (semua kasir)', () => {
    const stats = computeShiftStats(shift, [], [
      // shiftId match → selalu masuk walau cashier lain
      mv({ id: 'm1', date: '2026-08-18T10:00:00.000Z', type: 'in', amount: 30000, shiftId: 'shift-1', cashierId: 'u2' }),
      // fallback window: tanpa shiftId tapi dalam window (kasir lain — laci bersama)
      mv({ id: 'm2', date: '2026-08-18T11:00:00.000Z', type: 'out', amount: 5000, cashierId: 'u2' }),
      // sebelum shift → TIDAK dihitung
      mv({ id: 'm3', date: '2026-08-18T08:00:00.000Z', type: 'in', amount: 99999 }),
    ]);

    expect(stats.cashIn).toBe(30000);
    expect(stats.cashOut).toBe(5000);
    expect(stats.expectedCash).toBe(200000 + 30000 - 5000);
  });

  it('tanpa transaksi & movement → expected cash = modal awal', () => {
    const stats = computeShiftStats(shift, [], []);
    expect(stats).toEqual({ ...EMPTY_SHIFT_STATS, expectedCash: 200000 });
  });

  // ============================================================
  // v4.7 TO DO 20.1 — transaksi yang di-refund TIDAK dihitung sebagai penjualan,
  // tapi expectedCash tetap netral (uang tunai masuk laci lalu keluar via Kas Keluar Refund).
  // ============================================================

  it('20.1 — refund TUNAI: totalSales/totalTx mengecualikan refunded, expectedCash netral (net 0)', () => {
    const stats = computeShiftStats(shift, [
      // Penjualan tunai 50.000 yang sudah di-refund (movement Kas Keluar Refund 50.000 di bawah)
      tx({ id: 't1', date: '2026-08-18T10:00:00.000Z', totalAmount: 50000, paymentMethod: 'Cash', refunded: true }),
    ], [
      mv({ id: 'm1', date: '2026-08-18T10:30:00.000Z', type: 'out', amount: 50000, category: 'Refund' }),
    ]);

    // Laporan bersih: penjualan refunded TIDAK dihitung
    expect(stats.totalSales).toBe(0);
    expect(stats.totalTx).toBe(0);
    expect(stats.cashSales).toBe(0);
    expect(stats.refundedCashSales).toBe(50000);
    // Expected cash: laci menerima 50k (sale) lalu mengeluarkan 50k (refund) → net 0 = modal awal
    expect(stats.cashOut).toBe(50000);
    expect(stats.expectedCash).toBe(200000);
  });

  it('20.1 — campuran: sale tunai aktif + sale tunai di-refund → hanya yang aktif dihitung, expectedCash netral', () => {
    const stats = computeShiftStats(shift, [
      tx({ id: 't1', date: '2026-08-18T10:00:00.000Z', totalAmount: 50000, paymentMethod: 'Cash' }),
      tx({ id: 't2', date: '2026-08-18T10:30:00.000Z', totalAmount: 30000, paymentMethod: 'Cash', refunded: true }),
    ], [
      mv({ id: 'm1', date: '2026-08-18T10:45:00.000Z', type: 'out', amount: 30000, category: 'Refund' }),
    ]);

    expect(stats.totalSales).toBe(50000);
    expect(stats.totalTx).toBe(1);
    expect(stats.cashSales).toBe(50000);
    expect(stats.refundedCashSales).toBe(30000);
    // laci: +50k (aktif) +30k (refunded) −30k (refund) = +50k
    expect(stats.expectedCash).toBe(200000 + 50000);
  });

  it('20.1 — refund sale QRIS dari laci: qrisSales bersih, expectedCash berkurang (uang keluar laci)', () => {
    const stats = computeShiftStats(shift, [
      tx({ id: 't1', date: '2026-08-18T10:00:00.000Z', totalAmount: 50000, paymentMethod: 'QRIS', refunded: true }),
    ], [
      mv({ id: 'm1', date: '2026-08-18T10:30:00.000Z', type: 'out', amount: 50000, category: 'Refund' }),
    ]);

    expect(stats.totalSales).toBe(0);
    expect(stats.qrisSales).toBe(0);
    expect(stats.refundedCashSales).toBe(0); // bukan sale tunai → tidak di-add-back
    expect(stats.cashOut).toBe(50000);
    // laci tidak pernah menerima uang QRIS, tapi mengeluarkan 50k untuk refund → modal − 50k
    expect(stats.expectedCash).toBe(200000 - 50000);
  });

  it('20.1 — sale tunai di-refund LINTAS METODE (refund via QRIS, movement tercatat out): tidak regresi dari perilaku lama', () => {
    // Residual terdokumentasi (fix penuh butuh field refundMethod): movement 'out' tetap
    // dicatat walau uang tidak keluar laci — hasil sama dengan perilaku lama (net 0),
    // hanya angka laporan (totalSales/cashSales) yang kini bersih.
    const stats = computeShiftStats(shift, [
      tx({ id: 't1', date: '2026-08-18T10:00:00.000Z', totalAmount: 50000, paymentMethod: 'Cash', refunded: true }),
    ], [
      mv({ id: 'm1', date: '2026-08-18T10:30:00.000Z', type: 'out', amount: 50000, category: 'Refund' }),
    ]);

    expect(stats.totalSales).toBe(0);
    expect(stats.cashSales).toBe(0);
    expect(stats.refundedCashSales).toBe(50000);
    // Tanpa fix: cashSales lama menghitung sale refunded (50k) → net 0 juga.
    // Dengan fix: refundedCashSales di-add-back → net 0 tetap sama (tidak regresi).
    expect(stats.expectedCash).toBe(200000);
  });

  it('20.1 — refunded sale TANPA movement refund: tidak ada double-count (sama dengan perilaku lama)', () => {
    const stats = computeShiftStats(shift, [
      tx({ id: 't1', date: '2026-08-18T10:00:00.000Z', totalAmount: 50000, paymentMethod: 'Cash', refunded: true }),
    ], []);

    expect(stats.totalSales).toBe(0);
    expect(stats.refundedCashSales).toBe(50000);
    expect(stats.cashOut).toBe(0);
    // Perilaku lama: cashSales 50k (refunded) + cashOut 0 → expected = modal + 50k.
    // Perilaku baru: cashSales 0 + refundedCashSales 50k → expected = modal + 50k (sama).
    expect(stats.expectedCash).toBe(200000 + 50000);
  });
});
