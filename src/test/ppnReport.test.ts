import { describe, it, expect } from 'vitest';
import {
  isTaxableTransaction,
  toPpnRow,
  summarizePpn,
  aggregatePpnByDay,
} from '../utils/ppnReport';
import type { Transaction } from '../types';

function makeTx(over: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    queueNumber: 1,
    date: '2026-08-01T10:00:00.000Z',
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
// isTaxableTransaction
// ============================================================

describe('isTaxableTransaction (P0.1 — transaksi kena pajak)', () => {
  it('tax > 0 → kena pajak', () => {
    expect(isTaxableTransaction(makeTx({ tax: 10000 }))).toBe(true);
  });

  it('tax 0 / undefined → bukan kena pajak', () => {
    expect(isTaxableTransaction(makeTx({ tax: 0 }))).toBe(false);
    expect(isTaxableTransaction(makeTx({ tax: undefined }))).toBe(false);
  });
});

// ============================================================
// toPpnRow — semantik DPP/PPN/total
// ============================================================

describe('toPpnRow (P0.1 — DPP = subtotal − diskon, PPN = tax)', () => {
  it('tanpa diskon: DPP = subtotal, PPN = tax, total = totalAmount', () => {
    const r = toPpnRow(makeTx({ subtotal: 100000, tax: 11000, totalAmount: 111000 }));
    expect(r.dpp).toBe(100000);
    expect(r.ppn).toBe(11000);
    expect(r.total).toBe(111000);
    expect(r.queueNumber).toBe(1);
    expect(r.cashierName).toBe('Kasir 1');
  });

  it('dengan diskon: DPP = subtotal − diskon (net sales)', () => {
    const r = toPpnRow(makeTx({ subtotal: 100000, discount: 10000, tax: 9900, totalAmount: 99900 }));
    expect(r.dpp).toBe(90000);
    expect(r.ppn).toBe(9900);
    expect(r.total).toBe(99900);
  });

  it('diskon > subtotal → DPP di-clamp ke 0 (tidak negatif)', () => {
    const r = toPpnRow(makeTx({ subtotal: 5000, discount: 10000 }));
    expect(r.dpp).toBe(0);
  });
});

// ============================================================
// summarizePpn
// ============================================================

describe('summarizePpn (P0.1 — ringkasan periode)', () => {
  it('campuran kena pajak & non-pajak → total & hitungan benar', () => {
    const summary = summarizePpn([
      makeTx({ id: 'a', subtotal: 100000, discount: 10000, tax: 9900, totalAmount: 99900 }),
      makeTx({ id: 'b', subtotal: 50000, tax: 5500, totalAmount: 55500 }),
      makeTx({ id: 'c', subtotal: 20000, tax: 0, totalAmount: 20000 }),
    ]);
    expect(summary.taxableCount).toBe(2);
    expect(summary.exemptCount).toBe(1);
    expect(summary.totalDpp).toBe(90000 + 50000);
    expect(summary.totalPpn).toBe(9900 + 5500);
  });

  it('kosong → semua nol', () => {
    const summary = summarizePpn([]);
    expect(summary).toEqual({ totalDpp: 0, totalPpn: 0, taxableCount: 0, exemptCount: 0 });
  });
});

// ============================================================
// aggregatePpnByDay
// ============================================================

describe('aggregatePpnByDay (P0.1 — rekap harian)', () => {
  it('mengelompokkan per tanggal, ascending, hanya kena pajak', () => {
    const days = aggregatePpnByDay([
      makeTx({ id: 'a', date: '2026-08-02T08:00:00.000Z', subtotal: 50000, tax: 5000, totalAmount: 55000 }),
      makeTx({ id: 'b', date: '2026-08-01T10:00:00.000Z', subtotal: 100000, tax: 10000, totalAmount: 110000 }),
      makeTx({ id: 'c', date: '2026-08-01T15:00:00.000Z', subtotal: 20000, tax: 2000, totalAmount: 22000 }),
      makeTx({ id: 'd', date: '2026-08-03T09:00:00.000Z', subtotal: 9000, tax: 0, totalAmount: 9000 }), // non-pajak — di-skip
    ]);
    expect(days).toHaveLength(2); // 01 & 02 (03 non-pajak di-skip)
    expect(days[0].dateKey).toBe('2026-08-01');
    expect(days[0].txCount).toBe(2);
    expect(days[0].dpp).toBe(120000);
    expect(days[0].ppn).toBe(12000);
    expect(days[1].dateKey).toBe('2026-08-02');
    expect(days[1].dpp).toBe(50000);
    expect(days[1].ppn).toBe(5000);
  });

  it('tidak ada transaksi kena pajak → array kosong', () => {
    expect(aggregatePpnByDay([makeTx({ tax: 0 })])).toEqual([]);
  });
});
