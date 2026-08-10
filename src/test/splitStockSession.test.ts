import { describe, it, expect, afterEach } from 'vitest';
import {
  computeCartSignature,
  createSplitStockSession,
  accumulatePaidPortion,
  computeUnpaidPortion,
  setActiveSplitStockSession,
  releaseSplitReserveForCart,
  getActiveSplitStockSession,
  recordPaidBill,
  loadSplitStockSession,
} from '../utils/splitStockSession';
import { allocateProportional } from '../utils/splitAllocation';
import type { CartItem } from '../types';

function makeItem(name: string, quantity = 1, overrides: Partial<CartItem> = {}): CartItem {
  return {
    lineId: name,
    menuId: name,
    name,
    quantity,
    basePrice: 10000,
    price: 10000,
    subtotal: 10000 * quantity,
    addons: [],
    ...overrides,
  } as CartItem;
}

const originalLocalStorage = (globalThis as any).localStorage;

afterEach(() => {
  (globalThis as any).localStorage = originalLocalStorage;
  setActiveSplitStockSession(null); // reset holder antar test
});

const makeFakeStorage = () => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, value),
  } as Storage;
};

describe('computeCartSignature (TO DO 5.1)', () => {
  it('stabil terhadap urutan item yang sama (sort sebelum stringify)', () => {
    const a = [makeItem('A', 2), makeItem('B', 1)];
    const b = [makeItem('B', 1), makeItem('A', 2)];
    expect(computeCartSignature(a)).toBe(computeCartSignature(b));
  });

  it('berbeda jika quantity / menu berbeda', () => {
    expect(computeCartSignature([makeItem('A', 1)])).not.toBe(
      computeCartSignature([makeItem('A', 2)])
    );
    expect(computeCartSignature([makeItem('A')])).not.toBe(
      computeCartSignature([makeItem('B')])
    );
  });

  it('mendeteksi perubahan suhu & level gula (berbeda dengan signature POS 5.6)', () => {
    const hangat = makeItem('Es Teh', 1, { temperature: 'Hangat', sugar: 'Normal' });
    const dingin = makeItem('Es Teh', 1, { temperature: 'Dingin', sugar: 'Normal' });
    expect(computeCartSignature([hangat])).not.toBe(computeCartSignature([dingin]));
  });

  it('array kosong → signature kosong yang konsisten', () => {
    expect(computeCartSignature([])).toBe(computeCartSignature([]));
  });
});

describe('accumulatePaidPortion (cap per inventoryId — fix equal mode)', () => {
  it('mode equal: sub-bill membawa semua item → paid di-cap di reserved, tidak menumpuk penuh berulang', () => {
    const reserved = { 'inv-1': 2, 'inv-2': 3 };
    const session = createSplitStockSession('sig', reserved);

    // Sub-bill 1 (equal: membawa SEMUA item) → fullDeductions
    accumulatePaidPortion(session, { 'inv-1': 2, 'inv-2': 3 });
    expect(session.paid).toEqual({ 'inv-1': 2, 'inv-2': 3 });

    // Sub-bill 2 (equal: lagi-lagi membawa semua item) → TIDAK boleh jadi 4/6
    accumulatePaidPortion(session, { 'inv-1': 2, 'inv-2': 3 });
    expect(session.paid).toEqual({ 'inv-1': 2, 'inv-2': 3 });

    // Karena paid === reserved → unpaid portion kosong → tidak ada revert ganda
    expect(computeUnpaidPortion(session)).toEqual({});
  });

  it('mode item: sub-bill membawa item disjoint → paid menumpuk hingga reserved', () => {
    const reserved = { 'inv-1': 1, 'inv-2': 1 };
    const session = createSplitStockSession('sig', reserved);

    accumulatePaidPortion(session, { 'inv-1': 1 }); // Bill A: item 1
    accumulatePaidPortion(session, { 'inv-2': 1 }); // Bill B: item 2
    expect(session.paid).toEqual({ 'inv-1': 1, 'inv-2': 1 });

    // Semua lunas → unpaid kosong
    expect(computeUnpaidPortion(session)).toEqual({});
  });

  it('mode item parsial: hanya item bill yang lunas → sisanya tetap unpaid (dikembalikan saat batal)', () => {
    const reserved = { 'inv-1': 1, 'inv-2': 1, 'inv-3': 1 };
    const session = createSplitStockSession('sig', reserved);

    accumulatePaidPortion(session, { 'inv-1': 1 }); // hanya Bill A lunas
    expect(computeUnpaidPortion(session)).toEqual({ 'inv-2': 1, 'inv-3': 1 });
  });
});

describe('computeUnpaidPortion', () => {
  it('hanya nilai positif (reserved − paid)', () => {
    const session = createSplitStockSession('sig', { 'inv-1': 5, 'inv-2': 5 });
    accumulatePaidPortion(session, { 'inv-1': 3 });
    expect(computeUnpaidPortion(session)).toEqual({ 'inv-1': 2, 'inv-2': 5 });
  });

  it('sesi tanpa reserve → unpaid kosong', () => {
    const session = createSplitStockSession('sig', {});
    expect(computeUnpaidPortion(session)).toEqual({});
  });
});

describe('releaseSplitReserveForCart (POS beralih ke checkout normal)', () => {
  it('signature cocok → kembalikan unpaid & bersihkan sesi', () => {
    (globalThis as any).localStorage = makeFakeStorage();
    const items = [makeItem('A', 2), makeItem('B', 1)];
    const reserved = { 'inv-1': 2, 'inv-2': 1 };
    const session = createSplitStockSession(computeCartSignature(items), reserved);
    accumulatePaidPortion(session, { 'inv-1': 2 }); // Bill A lunas, Bill B belum
    setActiveSplitStockSession(session);

    const released = releaseSplitReserveForCart(items);
    expect(released).toEqual({ 'inv-2': 1 }); // hanya yang belum lunas dikembalikan
    expect(getActiveSplitStockSession()).toBeNull();
  });

  it('signature berbeda → no-op (sesi milik cart lain)', () => {
    (globalThis as any).localStorage = makeFakeStorage();
    const session = createSplitStockSession('cart-lain', { 'inv-1': 1 });
    setActiveSplitStockSession(session);

    const released = releaseSplitReserveForCart([makeItem('Z')]);
    expect(released).toBeNull();
    expect(getActiveSplitStockSession()).not.toBeNull();
  });

  it('tanpa sesi aktif → null', () => {
    expect(releaseSplitReserveForCart([makeItem('A')])).toBeNull();
  });
});

describe('recordPaidBill & resume session (TO DO 5.7/5.9)', () => {
  it('mencatat sub-bill lunas per index (payMethod + cash) dan menggabungkan tanpa menghapus lama', () => {
    const session = createSplitStockSession('sig', { 'inv-1': 6 });
    recordPaidBill(session, 0, 'Cash', 50000);
    recordPaidBill(session, 1, 'QRIS', 50000);
    expect(session.paidBills).toEqual({
      0: { payMethod: 'Cash', cash: 50000 },
      1: { payMethod: 'QRIS', cash: 50000 },
    });
    expect(Object.keys(session.paidBills!)).toHaveLength(2);
  });

  it('overwrite index yang sama (idempoten)', () => {
    const session = createSplitStockSession('sig', {});
    recordPaidBill(session, 2, 'Cash', 10000);
    recordPaidBill(session, 2, 'Transfer', 10000);
    expect(session.paidBills?.[2]).toEqual({ payMethod: 'Transfer', cash: 10000 });
  });

  it('persist/load round-trip mempertahankan paidBills, mode/count & queueNumber (resume lintas reload)', () => {
    (globalThis as any).localStorage = makeFakeStorage();
    const session = createSplitStockSession('sig', { 'inv-1': 6 });
    recordPaidBill(session, 0, 'Cash', 50000);
    session.mode = 'equal';
    session.count = 2;
    session.queueNumber = 42;
    setActiveSplitStockSession(session);

    const loaded = loadSplitStockSession();
    expect(loaded?.paidBills?.[0]).toEqual({ payMethod: 'Cash', cash: 50000 });
    expect(loaded?.mode).toBe('equal');
    expect(loaded?.count).toBe(2);
    expect(loaded?.queueNumber).toBe(42);
  });
});

describe('scaleHpp allocation (TO DO 5.2 — Σ hpp sub-bill equal === HPP induk)', () => {
  it('Math.round(totalHpp * (allocated_i / totalHpp)) === allocated_i dan Σ klop', () => {
    const cases: Array<[number, number]> = [
      [100000, 3],
      [99999, 3],
      [12345, 4],
      [1, 2],
      [77777, 5],
      [0, 3],
    ];
    for (const [totalHpp, count] of cases) {
      if (totalHpp <= 0) continue;
      const allocated = allocateProportional(totalHpp, Array(count).fill(1 / count));
      const scaled = allocated.map((a) => Math.round(totalHpp * (a / totalHpp)));
      expect(scaled, `HPP=${totalHpp}, N=${count}`).toEqual(allocated);
      expect(scaled.reduce((x, y) => x + y, 0), `Σ untuk HPP=${totalHpp}`).toBe(totalHpp);
    }
  });
});
