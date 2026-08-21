import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cloudSync agar test store tidak menyentuh network (fire-and-forget sync dari store).
// Sertakan export yang dipakai store lain (menuStore/inventoryStore/auditLogStore/stockLogStore)
// sebagai no-op vi.fn() agar mock tahan terhadap test yang memicu loadFromCloud di masa depan.
vi.mock('../lib/cloudSync', () => ({
  syncTransaction: vi.fn(),
  syncTransactionStatus: vi.fn(),
  syncTransactionTxStatus: vi.fn(),
  deleteTransactionCloud: vi.fn(),
  syncMenu: vi.fn(),
  deleteMenuCloud: vi.fn(),
  fetchMenusFromCloud: vi.fn().mockResolvedValue([]),
  syncCustomCategories: vi.fn(),
  fetchCustomCategoriesFromCloud: vi.fn().mockResolvedValue([]),
  syncInventoryItem: vi.fn(),
  syncInventoryStock: vi.fn(), // v4.7 TO DO 8.3: nama baru (unifikasi jalur sync stok)
  adjustInventoryStockCloud: vi.fn().mockResolvedValue({ ok: [], conflicts: [], degraded: false }),
  fetchMaxQueueNumberCloud: vi.fn().mockResolvedValue(0),
  allocateQueueNumberCloud: vi.fn().mockResolvedValue(null),
  deleteInventoryCloud: vi.fn(),
  fetchInventoryFromCloud: vi.fn().mockResolvedValue([]),
  syncStockLog: vi.fn(),
  syncStockLogsBulk: vi.fn(),
  syncAuditLog: vi.fn(),
  fetchAuditLogsFromCloud: vi.fn().mockResolvedValue([]),
}));

import type { Transaction, CartItem, Menu, RecipeIngredientSnapshot } from '../types';
import {
  useTransactionStore,
  hasPendingSplitChildren,
} from '../store/transactionStore';
import { useMenuStore } from '../store/menuStore';
import { useInventoryStore } from '../store/inventoryStore';

function makeItem(menuId: string, qty: number, recipeSnapshot: RecipeIngredientSnapshot[]): CartItem {
  return {
    lineId: `${menuId}-${qty}`,
    menuId,
    name: `Menu ${menuId}`,
    basePrice: 10000,
    price: 10000,
    quantity: qty,
    temperature: 'Normal',
    sugar: 'Normal',
    addons: [],
    subtotal: 10000 * qty,
    recipeSnapshot,
  } as unknown as CartItem;
}

function makePending(id: string, queueNumber: number, items: CartItem[]): Transaction {
  return {
    id,
    queueNumber,
    date: new Date().toISOString(),
    items,
    subtotal: items.reduce((a, i) => a + i.subtotal, 0),
    discount: 0,
    totalAmount: items.reduce((a, i) => a + i.subtotal, 0),
    paymentMethod: 'Cash',
    kitchenStatus: 'Waiting',
    txStatus: 'Pending',
    isPending: true,
    cashierId: 'u1',
    cashierName: 'Kasir',
  } as Transaction;
}

const SNAPSHOT: RecipeIngredientSnapshot[] = [
  {
    inventoryId: 'invA',
    inventoryName: 'Beras',
    unit: 'kg',
    qty: 2, // per 1 unit menu
    totalQty: 6, // 2 * qty item (3)
    unitCost: 5000,
    subtotalCost: 30000,
    source: 'menu',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  useMenuStore.setState({ menus: [] });
  useInventoryStore.setState({ items: [] });
  useTransactionStore.setState({ transactions: [], deletedLocalIds: [] });
});

describe('cancelPendingTransaction (TO DO 5.3 & 5.4)', () => {
  it('5.4: revert memakai recipeSnapshot TERSIMPAN — benar walau menu sudah dihapus dari menuStore', () => {
    // Menu m1 TIDAK ada di menuStore (sudah dihapus). Kode lama (createSnapshotForCartItems)
    // akan membangun snapshot dari menu saat ini → kosong → revert 0 → stok bocor.
    const tx = makePending('p1', 1, [makeItem('m1', 3, SNAPSHOT)]);
    useTransactionStore.setState({ transactions: [tx] });
    const revertSpy = vi.spyOn(useInventoryStore.getState(), 'revertStock');

    useTransactionStore.getState().cancelPendingTransaction('p1');

    expect(revertSpy).toHaveBeenCalledTimes(1);
    expect(revertSpy).toHaveBeenCalledWith({ invA: 6 }, expect.stringContaining('Void Pending #1'));
    expect(useTransactionStore.getState().transactions.find((t) => t.id === 'p1')?.txStatus).toBe('Cancel');
  });

  it('5.3: pending ber-anak split (splitParentId === id) TIDAK me-revert stok — dikelola sesi split', () => {
    const parent = makePending('parent1', 5, [makeItem('m1', 3, SNAPSHOT)]);
    const child = {
      ...makePending('child1', 6, [makeItem('m1', 3, SNAPSHOT)]),
      txStatus: 'Selesai',
      splitParentId: 'parent1',
      splitIndex: 1,
      totalSplitCount: 2,
    } as Transaction;
    useTransactionStore.setState({ transactions: [parent, child] });
    const revertSpy = vi.spyOn(useInventoryStore.getState(), 'revertStock');

    useTransactionStore.getState().cancelPendingTransaction('parent1');

    expect(revertSpy).not.toHaveBeenCalled();
    // Status tetap di-cancel (parent void) — hanya stok yang tidak di-revert
    expect(useTransactionStore.getState().transactions.find((t) => t.id === 'parent1')?.txStatus).toBe('Cancel');
  });

  it('tanpa item: status di-cancel tanpa revert stok', () => {
    const tx = makePending('p2', 2, []);
    useTransactionStore.setState({ transactions: [tx] });
    const revertSpy = vi.spyOn(useInventoryStore.getState(), 'revertStock');

    useTransactionStore.getState().cancelPendingTransaction('p2');

    expect(revertSpy).not.toHaveBeenCalled();
  });

  it('transaksi lama tanpa recipeSnapshot: fallback menu.ingredients tetap revert (2.1 legacy path)', () => {
    useMenuStore.setState({
      menus: [
        {
          id: 'm1',
          name: 'Nasi Goreng',
          category: 'Makanan',
          price: 15000,
          ingredients: { invB: 0.5 },
          availableAddons: [],
        } as Menu,
      ],
    });
    const tx = makePending('p3', 3, [makeItem('m1', 4, [])]); // tanpa snapshot
    useTransactionStore.setState({ transactions: [tx] });
    const revertSpy = vi.spyOn(useInventoryStore.getState(), 'revertStock');

    useTransactionStore.getState().cancelPendingTransaction('p3');

    expect(revertSpy).toHaveBeenCalledTimes(1);
    expect(revertSpy).toHaveBeenCalledWith({ invB: 2 }, expect.any(String)); // 0.5 * 4
  });

  it('id tidak ditemukan: tidak melakukan apa-apa', () => {
    const revertSpy = vi.spyOn(useInventoryStore.getState(), 'revertStock');
    useTransactionStore.getState().cancelPendingTransaction('tidak-ada');
    expect(revertSpy).not.toHaveBeenCalled();
  });
});

describe('hasPendingSplitChildren (TO DO 5.3 — predicate murni)', () => {
  it('mendeteksi parent yang memiliki anak split; anak itu sendiri bukan parent', () => {
    const parent = makePending('a', 1, []);
    const child = { ...makePending('b', 2, []), splitParentId: 'a' } as Transaction;

    expect(hasPendingSplitChildren([parent, child], 'a')).toBe(true);
    expect(hasPendingSplitChildren([parent], 'a')).toBe(false);
    // Anak itu sendiri menunjuk ke 'a' → tetap terdeteksi sebagai "punya anak split" untuk id 'a'
    expect(hasPendingSplitChildren([child], 'a')).toBe(true);
    expect(hasPendingSplitChildren([parent, child], 'b')).toBe(false);
  });
});
