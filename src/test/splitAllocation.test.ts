import { describe, it, expect } from 'vitest';
import { allocateProportional, buildEqualSplitReceipt } from '../utils/splitAllocation';
import type { CartItem, Transaction } from '../types';

function makeItem(name: string, subtotal: number): CartItem {
  return {
    lineId: name,
    menuId: name,
    name,
    quantity: 1,
    basePrice: subtotal,
    price: subtotal,
    subtotal,
    addons: [],
  } as CartItem;
}

function makeTx(items: CartItem[], subtotal: number, splitIndex?: number, totalSplitCount?: number): Transaction {
  return {
    id: 't1',
    queueNumber: 1,
    date: new Date().toISOString(),
    items,
    subtotal,
    discount: 0,
    totalAmount: subtotal,
    paymentMethod: 'Cash',
    kitchenStatus: 'Waiting',
    txStatus: 'Selesai',
    cashierId: 'u1',
    cashierName: 'Kasir',
    splitIndex,
    totalSplitCount,
  } as Transaction;
}

describe('allocateProportional (TO DO 2.2 — Largest Remainder Method)', () => {
  it('pembagian rata 3 orang: 100.000 → 33.333, 33.333, 33.334 (total klop)', () => {
    const result = allocateProportional(100000, [1 / 3, 1 / 3, 1 / 3]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100000);
    // Selisih antar sub-bill maksimal 1 rupiah (tidak ada rounding error)
    expect(Math.max(...result) - Math.min(...result)).toBeLessThanOrEqual(1);
  });

  it('Σ hasil === total untuk berbagai kasus (equal & proporsional)', () => {
    const cases: Array<[number, number[]]> = [
      [10000, [0.5, 0.5]],
      [1, [0.5, 0.5]],
      [9999, [0.25, 0.25, 0.25, 0.25]],
      [12345, [0.1, 0.2, 0.3, 0.4]],
      [10, [0.33, 0.33, 0.34]], // ratio tidak bulat 1
      [77777, [1 / 3, 1 / 3, 1 / 3]],
      [90000, [2 / 3, 1 / 3]], // discount lebih besar dari sebagian bill
      [0, [0.5, 0.5]],
    ];
    for (const [total, ratios] of cases) {
      const result = allocateProportional(total, ratios);
      expect(result.reduce((a, b) => a + b, 0), `total=${total}, ratios=${ratios}`).toBe(total);
      expect(result.length).toBe(ratios.length);
      result.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    }
  });

  it('hardening: semua ratio 0 dengan total > 0 tetap total-klop (sisa ke indeks pertama)', () => {
    const result = allocateProportional(100, [0, 0]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('setiap elemen hasil adalah integer', () => {
    const result = allocateProportional(12345, [0.1, 0.2, 0.3, 0.4]);
    result.forEach((v) => expect(Number.isInteger(v)).toBe(true));
  });

  it('total 0 atau array kosong → semua 0 / kosong', () => {
    expect(allocateProportional(0, [0.3, 0.7])).toEqual([0, 0]);
    expect(allocateProportional(100, [])).toEqual([]);
  });
});

describe('buildEqualSplitReceipt (TO DO 2.3 — struk mode Equal)', () => {
  it('mode equal: label BAGIAN N DARI M + Σ item === subtotal bagian', () => {
    // Total pesanan 100.000 dibagi rata 3 → subtotal sub-bill 33.333
    const tx = makeTx(
      [makeItem('Nasi Goreng', 50000), makeItem('Kopi Susu', 30000), makeItem('Es Teh', 20000)],
      33333,
      1,
      3
    );
    const result = buildEqualSplitReceipt(tx);
    expect(result).not.toBeNull();
    expect(result!.header).toContain('BAGIAN 1 DARI 3');
    const sum = result!.items.reduce((a, i) => a + i.subtotal, 0);
    expect(sum).toBe(33333); // Σ item = subtotal bagian, tanpa selisih
  });

  it('mode item (Σ item = subtotal bill) → null (tidak diubah)', () => {
    const tx = makeTx([makeItem('Nasi Goreng', 50000)], 50000);
    expect(buildEqualSplitReceipt(tx)).toBeNull();
  });

  it('subtotal 0 (bill berisi hanya bundle child) → null (guard)', () => {
    const tx = makeTx([makeItem('Child', 0)], 0);
    expect(buildEqualSplitReceipt(tx)).toBeNull();
  });

  it('equal 3 arah: selisih antar subtotal item ≤ 1 rupiah', () => {
    const tx = makeTx(
      [makeItem('A', 100000), makeItem('B', 100000), makeItem('C', 100000)],
      100000,
      1,
      3
    );
    const result = buildEqualSplitReceipt(tx);
    const sums = result!.items.map((i) => i.subtotal);
    expect(Math.max(...sums) - Math.min(...sums)).toBeLessThanOrEqual(1);
    expect(sums.reduce((a, b) => a + b, 0)).toBe(100000);
  });
});
