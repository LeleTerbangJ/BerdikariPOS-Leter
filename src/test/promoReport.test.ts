import { describe, it, expect } from 'vitest';
import {
  isPromoEligibleTx,
  resolvePromoName,
  toPromoDetailRow,
  aggregatePromoPerformance,
} from '../utils/promoReport';
import type { Transaction, Promo } from '../types';

function makeTx(over: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    queueNumber: 1,
    date: '2026-08-01T10:00:00.000Z',
    items: [],
    subtotal: 100000,
    discount: 10000,
    totalAmount: 90000,
    paymentMethod: 'Cash',
    kitchenStatus: 'Done',
    txStatus: 'Selesai',
    cashierId: 'u1',
    cashierName: 'Kasir 1',
    hpp: 50000,
    tax: 0,
    ...over,
  };
}

const promoA: Promo = {
  id: 'promo-a',
  name: 'Diskon 10%',
  code: 'HEM10',
  type: 'percentage',
  value: 10,
  scope: 'all',
  isActive: true,
  usageCount: 0,
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2026-12-31T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// ============================================================
// isPromoEligibleTx
// ============================================================

describe('isPromoEligibleTx (P-A3 — kelayakan transaksi laporan promo)', () => {
  it('Selesai normal → layak', () => {
    expect(isPromoEligibleTx(makeTx({}))).toBe(true);
  });

  it('status bukan Selesai (Cancel/Demo/Pending) → tidak layak', () => {
    expect(isPromoEligibleTx(makeTx({ txStatus: 'Cancel' }))).toBe(false);
    expect(isPromoEligibleTx(makeTx({ txStatus: 'Demo' }))).toBe(false);
    expect(isPromoEligibleTx(makeTx({ txStatus: 'Pending' }))).toBe(false);
  });

  it('sub-bill split (splitParentId) → tidak layak (anti double accounting)', () => {
    expect(isPromoEligibleTx(makeTx({ splitParentId: 'parent-1' }))).toBe(false);
  });

  it('transaksi refunded → tidak layak (pendapatan sudah dikembalikan)', () => {
    expect(isPromoEligibleTx(makeTx({ refunded: true }))).toBe(false);
  });
});

// ============================================================
// resolvePromoName
// ============================================================

describe('resolvePromoName (P-A3 — snapshot nama vs fallback)', () => {
  it('pakai snapshot promoName tersimpan (tahan edit/hapus promo)', () => {
    const tx = makeTx({ appliedPromoId: 'promo-a', promoName: 'Diskon 10% (lama)' });
    expect(resolvePromoName(tx, [promoA])).toBe('Diskon 10% (lama)');
  });

  it('fallback ke lookup promo bila tidak ada snapshot (data legacy)', () => {
    const tx = makeTx({ appliedPromoId: 'promo-a' });
    expect(resolvePromoName(tx, [promoA])).toBe('Diskon 10%');
  });

  it('appliedPromoId tanpa lookup → "Promo (tidak ditemukan)" (promo dihapus)', () => {
    const tx = makeTx({ appliedPromoId: 'promo-hilang' });
    expect(resolvePromoName(tx, [])).toBe('Promo (tidak ditemukan)');
  });

  it('tanpa promo → "Tanpa Promo"', () => {
    expect(resolvePromoName(makeTx({}), [])).toBe('Tanpa Promo');
  });
});

// ============================================================
// toPromoDetailRow
// ============================================================

describe('toPromoDetailRow (P-A3 — baris detail transaksi)', () => {
  it('memetakan semua field penting', () => {
    const tx = makeTx({
      id: 'tx-x',
      queueNumber: 42,
      date: '2026-08-02T08:00:00.000Z',
      cashierName: 'Kasir 2',
      customerName: 'Budi',
      appliedPromoId: 'promo-a',
      promoName: 'Diskon 10%',
      promoAmount: 10000,
      totalAmount: 90000,
    });
    const r = toPromoDetailRow(tx, [promoA]);
    expect(r.transactionId).toBe('tx-x');
    expect(r.queueNumber).toBe(42);
    expect(r.date).toBe('2026-08-02T08:00:00.000Z');
    expect(r.cashierName).toBe('Kasir 2');
    expect(r.customerName).toBe('Budi');
    expect(r.promoId).toBe('promo-a');
    expect(r.promoName).toBe('Diskon 10%');
    expect(r.promoAmount).toBe(10000);
    expect(r.totalAmount).toBe(90000);
  });

  it('promoAmount undefined → 0 (data legacy)', () => {
    const r = toPromoDetailRow(makeTx({ appliedPromoId: 'promo-a', promoName: 'X' }), [promoA]);
    expect(r.promoAmount).toBe(0);
  });
});

// ============================================================
// aggregatePromoPerformance
// ============================================================

describe('aggregatePromoPerformance (P-A3 — laporan performa promo)', () => {
  it('mengelompokkan per promo, menjumlahkan usage/diskon/omset', () => {
    const report = aggregatePromoPerformance(
      [
        makeTx({ id: 'a', appliedPromoId: 'promo-a', promoName: 'Diskon 10%', promoAmount: 10000, totalAmount: 90000 }),
        makeTx({ id: 'b', appliedPromoId: 'promo-a', promoName: 'Diskon 10%', promoAmount: 5000, totalAmount: 45000 }),
        makeTx({ id: 'c', appliedPromoId: 'promo-b', promoName: 'Voucher 20K', promoAmount: 20000, totalAmount: 80000 }),
        makeTx({ id: 'd' }), // tanpa promo → masuk manualDiscount
      ],
      [promoA]
    );

    expect(report.rows).toHaveLength(2);
    const rowA = report.rows.find((r) => r.promoId === 'promo-a')!;
    expect(rowA.usageCount).toBe(2);
    expect(rowA.totalDiscount).toBe(15000);
    expect(rowA.totalRevenue).toBe(135000);
    expect(rowA.avgDiscount).toBe(7500);

    const rowB = report.rows.find((r) => r.promoId === 'promo-b')!;
    expect(rowB.usageCount).toBe(1);
    expect(rowB.totalDiscount).toBe(20000);

    expect(report.summary.promoUsageCount).toBe(3);
    expect(report.summary.totalPromoDiscount).toBe(35000);
    expect(report.summary.totalPromoRevenue).toBe(215000);
    // manualDiscount hanya dari transaksi TANPA promo
    expect(report.summary.manualDiscount).toBe(10000);

    expect(report.details).toHaveLength(3);
  });

  it('diurutkan total diskon tertinggi dulu', () => {
    const report = aggregatePromoPerformance([
      makeTx({ id: 'a', appliedPromoId: 'p1', promoName: 'A', promoAmount: 5000 }),
      makeTx({ id: 'b', appliedPromoId: 'p2', promoName: 'B', promoAmount: 20000 }),
      makeTx({ id: 'c', appliedPromoId: 'p3', promoName: 'C', promoAmount: 10000 }),
    ]);
    expect(report.rows.map((r) => r.promoId)).toEqual(['p2', 'p3', 'p1']);
  });

  it('fallback nama dari daftar promo untuk data legacy (tanpa promoName)', () => {
    const report = aggregatePromoPerformance(
      [makeTx({ id: 'a', appliedPromoId: 'promo-a', promoAmount: 5000 })],
      [promoA]
    );
    expect(report.rows[0].promoName).toBe('Diskon 10%');
    expect(report.details[0].promoName).toBe('Diskon 10%');
  });

  it('detail diurutkan terbaru dulu; ineligible (split/refund/bukan Selesai) di-skip', () => {
    const report = aggregatePromoPerformance([
      makeTx({ id: 'old', date: '2026-08-01T10:00:00.000Z', appliedPromoId: 'p1', promoName: 'A', promoAmount: 5000 }),
      makeTx({ id: 'new', date: '2026-08-03T10:00:00.000Z', appliedPromoId: 'p1', promoName: 'A', promoAmount: 3000 }),
      makeTx({ id: 'split', splitParentId: 'parent', appliedPromoId: 'p1', promoName: 'A', promoAmount: 9999 }),
      makeTx({ id: 'refund', refunded: true, appliedPromoId: 'p1', promoName: 'A', promoAmount: 9999 }),
      makeTx({ id: 'cancel', txStatus: 'Cancel', appliedPromoId: 'p1', promoName: 'A', promoAmount: 9999 }),
    ]);
    expect(report.details).toHaveLength(2);
    expect(report.details[0].transactionId).toBe('new');
    expect(report.details[1].transactionId).toBe('old');
    expect(report.summary.totalPromoDiscount).toBe(8000);
    expect(report.summary.promoUsageCount).toBe(2);
  });

  it('kosong → rows & details kosong, summary nol', () => {
    const report = aggregatePromoPerformance([]);
    expect(report.rows).toEqual([]);
    expect(report.details).toEqual([]);
    expect(report.summary).toEqual({
      promoUsageCount: 0,
      totalPromoDiscount: 0,
      totalPromoRevenue: 0,
      manualDiscount: 0,
    });
  });
});
