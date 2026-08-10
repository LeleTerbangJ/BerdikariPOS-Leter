import { describe, it, expect, afterEach } from 'vitest';
import {
  pruneTransactionsForStorage,
  capEntries,
  filterTombstoned,
  pruneConfirmedTombstones,
  DEFAULT_TRANSACTION_KEEP,
} from '../utils/storagePrune';
import { safeStorage } from '../utils/safeStorage';
import type { Transaction } from '../types';

function makeTx(id: string, dateOffsetDays: number, overrides: Partial<Transaction> = {}): Transaction {
  const d = new Date();
  d.setDate(d.getDate() - dateOffsetDays);
  return {
    id,
    queueNumber: 1,
    date: d.toISOString(),
    items: [],
    subtotal: 0,
    discount: 0,
    totalAmount: 0,
    paymentMethod: 'Cash',
    kitchenStatus: 'Waiting',
    txStatus: 'Selesai',
    cashierId: 'u1',
    cashierName: 'Kasir',
    hpp: 0,
    ...overrides,
  };
}

describe('pruneTransactionsForStorage', () => {
  const now = Date.now();

  it('mempertahankan urutan input descending (invariant store) tanpa mengubah urutan', () => {
    // Prasyarat fungsi: input sudah terurut desc (addTransaction prepends, loadFromCloud sort desc)
    const txs = [makeTx('new', 1), makeTx('mid', 20), makeTx('old', 50)];
    const result = pruneTransactionsForStorage(txs, now);
    expect(result.map((t) => t.id)).toEqual(['new', 'mid', 'old']);
  });

  it('memotong ke maxCount transaksi terbaru', () => {
    const txs = Array.from({ length: 400 }, (_, i) => makeTx(`tx-${i}`, i));
    const result = pruneTransactionsForStorage(txs, now, 300, 3650); // TTL lebar agar hanya maxCount yang aktif
    expect(result.length).toBe(300);
  });

  it('mempertahankan jendela TTL (90 hari) bila lebih kecil dari maxCount', () => {
    // 5 transaksi dalam 90 hari + 400 transaksi lebih tua (di luar window) → hasil = 5 (hanya window)
    const recent = Array.from({ length: 5 }, (_, i) => makeTx(`recent-${i}`, i));
    const old = Array.from({ length: 400 }, (_, i) => makeTx(`old-${i}`, 100 + i));
    const result = pruneTransactionsForStorage([...old, ...recent], now, 300, 90);
    expect(result.length).toBe(5);
  });

  it('selalu mempertahankan transaksi Pending walau di luar window', () => {
    const pending = makeTx('pending-lama', 200, { txStatus: 'Pending', isPending: true });
    const others = Array.from({ length: 400 }, (_, i) => makeTx(`tx-${i}`, 95 + i));
    const result = pruneTransactionsForStorage([pending, ...others], now, 300, 90);
    expect(result.some((t) => t.id === 'pending-lama')).toBe(true);
  });

  it('menghapus duplikat ID saat menggabungkan window + top', () => {
    const dup = makeTx('sama', 10);
    const result = pruneTransactionsForStorage([dup, { ...dup, items: [] }], now, 300, 90);
    expect(result.length).toBe(1);
  });

  it('input kosong → hasil kosong', () => {
    expect(pruneTransactionsForStorage([], now)).toEqual([]);
  });
});

describe('filterTombstoned', () => {
  it('membuang transaksi yang id-nya di-tombstone', () => {
    const txs = [makeTx('a', 1), makeTx('b', 2), makeTx('c', 3)];
    const result = filterTombstoned(txs, ['b']);
    expect(result.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('tanpa tombstone → semua dipertahankan', () => {
    const txs = [makeTx('a', 1)];
    expect(filterTombstoned(txs, [])).toHaveLength(1);
  });
});

describe('pruneConfirmedTombstones', () => {
  it('mempertahankan tombstone yang masih ada di cloud', () => {
    expect(pruneConfirmedTombstones(['x', 'y'], ['x'])).toEqual(['x']);
  });

  it('membuang tombstone saat id sudah hilang dari cloud (delete dikonfirmasi)', () => {
    expect(pruneConfirmedTombstones(['x', 'y'], [])).toEqual([]);
  });
});

describe('capEntries', () => {
  it('memotong array ke maxCount', () => {
    expect(capEntries([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
  });

  it('array lebih kecil dari cap tidak berubah', () => {
    expect(capEntries([1, 2], 5)).toEqual([1, 2]);
  });

  it('DEFAULT_TRANSACTION_KEEP konsisten', () => {
    expect(DEFAULT_TRANSACTION_KEEP).toBe(300);
  });
});

describe('safeStorage', () => {
  const originalLocalStorage = (globalThis as any).localStorage;

  afterEach(() => {
    (globalThis as any).localStorage = originalLocalStorage;
  });

  const makeFakeStorage = (failSetItem = false) => {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => [...store.keys()][index] ?? null,
      removeItem: (key: string) => void store.delete(key),
      setItem: (key: string, value: string) => {
        if (failSetItem) {
          throw new DOMException('Setting the value exceeded the quota.', 'QuotaExceededError');
        }
        store.set(key, value);
      },
    } as Storage;
  };

  it('tidak melempar saat localStorage.setItem ditolak (kuota penuh)', () => {
    (globalThis as any).localStorage = makeFakeStorage(true);
    expect(() => safeStorage.setItem('test-key', 'value')).not.toThrow();
  });

  it('setItem normal tetap menyimpan nilai saat storage sehat', () => {
    const fake = makeFakeStorage(false);
    (globalThis as any).localStorage = fake;
    safeStorage.setItem('test-key', 'value');
    expect(fake.getItem('test-key')).toBe('value');
  });

  it('getItem meneruskan nilai dari storage', () => {
    const fake = makeFakeStorage(false);
    fake.setItem('test-key', 'hello');
    (globalThis as any).localStorage = fake;
    expect(safeStorage.getItem('test-key')).toBe('hello');
  });
});
