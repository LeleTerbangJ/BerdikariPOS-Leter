import { describe, it, expect } from 'vitest';
import {
  REFUND_CASH_CATEGORY,
  isRefundableTransaction,
  refundAmount,
  refundMovementNotes,
  buildRefundCashMovement,
} from '../utils/refund';
import type { Transaction } from '../types';

function makeTx(over: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    queueNumber: 42,
    date: '2026-08-10T10:00:00.000Z',
    items: [],
    subtotal: 100000,
    discount: 0,
    totalAmount: 110000,
    paymentMethod: 'Cash',
    kitchenStatus: 'Done',
    txStatus: 'Selesai',
    cashierId: 'u1',
    cashierName: 'Kasir 1',
    hpp: 50000,
    tax: 10000,
    ...over,
  };
}

// ============================================================
// isRefundableTransaction
// ============================================================

describe('isRefundableTransaction (P0.2 — guard refund)', () => {
  it('Selesai + belum refunded + bukan split + nominal > 0 → bisa di-refund', () => {
    expect(isRefundableTransaction(makeTx({}), false)).toBe(true);
  });

  it('sudah refunded → TIDAK bisa (anti double-refund)', () => {
    expect(isRefundableTransaction(makeTx({ refunded: true }), false)).toBe(false);
  });

  it('status bukan Selesai (Pending/Cancel/Demo) → tidak bisa', () => {
    expect(isRefundableTransaction(makeTx({ txStatus: 'Pending' }), false)).toBe(false);
    expect(isRefundableTransaction(makeTx({ txStatus: 'Cancel' }), false)).toBe(false);
    expect(isRefundableTransaction(makeTx({ txStatus: 'Demo' }), false)).toBe(false);
  });

  it('sub-bill split (anak) / induk ber-anak split → tidak bisa (stok dikelola sesi split)', () => {
    expect(isRefundableTransaction(makeTx({ splitParentId: 'parent-1' }), false)).toBe(false);
    expect(isRefundableTransaction(makeTx({}), true)).toBe(false);
  });

  it('totalAmount 0 → tidak bisa', () => {
    expect(isRefundableTransaction(makeTx({ totalAmount: 0 }), false)).toBe(false);
  });
});

// ============================================================
// refundAmount
// ============================================================

describe('refundAmount (P0.2 — refund penuh = totalAmount)', () => {
  it('full refund = totalAmount', () => {
    expect(refundAmount(makeTx({ totalAmount: 110000 }))).toBe(110000);
  });

  it('clamp negatif → 0', () => {
    expect(refundAmount(makeTx({ totalAmount: -5000 }))).toBe(0);
  });
});

// ============================================================
// refundMovementNotes & buildRefundCashMovement
// ============================================================

describe('buildRefundCashMovement (P0.2 — Kas Keluar akuntabel di Rekap Kas)', () => {
  it('tipe out, kategori Refund, nominal = totalAmount, link ke nomor antrean', () => {
    const m = buildRefundCashMovement(makeTx({ totalAmount: 110000 }), 'u9', 'Budi', 'pesanan basi');
    expect(m.type).toBe('out');
    expect(m.category).toBe(REFUND_CASH_CATEGORY);
    expect(m.amount).toBe(110000);
    expect(m.notes).toContain('#42');
    expect(m.notes).toContain('pesanan basi');
    expect(m.cashierId).toBe('u9');
    expect(m.cashierName).toBe('Budi');
    expect(m.id).toBeTruthy();
    expect(m.date).toBeTruthy();
  });

  it('refundMovementNotes tanpa alasan → hanya link antrean', () => {
    expect(refundMovementNotes(makeTx({}), undefined)).toBe('Refund transaksi #42');
  });
});
