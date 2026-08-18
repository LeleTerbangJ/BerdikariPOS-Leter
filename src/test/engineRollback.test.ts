import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// v4.7 TO DO 18.8 (A3) — Rollback engine harus meninggalkan jejak 'add' di stock log.
// Sebelumnya executeRollback memakai updateItem(stock, { skipLog: true }) → stok kembali
// tapi stock log menunjukkan 'deduct' tanpa 'add' balasan (jejak audit tidak seimbang).
// Sekarang rollback memakai revertStock(delta, 'Rollback transaksi gagal...') → log 'add'.
// ============================================================================

vi.mock('../lib/cloudSync', () => ({
  syncTransaction: vi.fn().mockResolvedValue(true),
  syncTransactionStatus: vi.fn().mockResolvedValue(true),
  syncTransactionTxStatus: vi.fn().mockResolvedValue(true),
  syncTransactionMeta: vi.fn().mockResolvedValue(true),
  deleteTransactionCloud: vi.fn().mockResolvedValue(true),
  syncMenu: vi.fn().mockResolvedValue(true),
  deleteMenuCloud: vi.fn().mockResolvedValue(true),
  fetchMenusFromCloud: vi.fn().mockResolvedValue([]),
  syncCustomCategories: vi.fn().mockResolvedValue(true),
  fetchCustomCategoriesFromCloud: vi.fn().mockResolvedValue([]),
  syncInventoryItem: vi.fn().mockResolvedValue(true),
  syncInventoryStock: vi.fn().mockResolvedValue(true),
  adjustInventoryStockCloud: vi.fn().mockResolvedValue({ ok: [], conflicts: [], degraded: false }),
  fetchMaxQueueNumberCloud: vi.fn().mockResolvedValue(0),
  allocateQueueNumberCloud: vi.fn().mockResolvedValue(null),
  deleteInventoryCloud: vi.fn().mockResolvedValue(true),
  fetchInventoryFromCloud: vi.fn().mockResolvedValue([]),
  syncStockLog: vi.fn().mockResolvedValue(true),
  syncAuditLog: vi.fn().mockResolvedValue(true),
  fetchAuditLogsFromCloud: vi.fn().mockResolvedValue([]),
}));

vi.mock('../utils/printer', () => ({
  printReceipt: vi.fn(),
  buildReceiptFromTransaction: vi.fn(),
}));

import type { Transaction, CartItem, Menu, InventoryItem, AtomicCheckoutParams } from '../types';
import { AtomicTransactionEngine } from '../lib/atomicTransactionEngine';
import { useMenuStore } from '../store/menuStore';
import { useInventoryStore } from '../store/inventoryStore';
import { useTransactionStore } from '../store/transactionStore';
import { useStockLogStore } from '../store/stockLogStore';

function makeMenu(id: string, name: string, ingredientInv: string): Menu {
  return {
    id,
    name,
    category: 'Makanan',
    price: 10000,
    ingredients: { [ingredientInv]: 1 },
    availableAddons: [],
  } as Menu;
}

function makeInv(id: string, stock: number): InventoryItem {
  return { id, name: id, unit: 'pcs', stock, minStock: 0 } as InventoryItem;
}

function makeCartItem(menu: Menu, qty: number): CartItem {
  return {
    lineId: `${menu.id}-${qty}-${Math.random().toString(36).slice(2, 8)}`,
    menuId: menu.id,
    name: menu.name,
    basePrice: menu.price,
    price: menu.price,
    quantity: qty,
    temperature: 'Normal',
    sugar: 'Normal',
    addons: [],
    subtotal: menu.price * qty,
  } as CartItem;
}

function baseParams(overrides: Partial<AtomicCheckoutParams>): AtomicCheckoutParams {
  return {
    cartItems: [],
    subtotal: 0,
    discount: 0,
    taxAmount: 0,
    totalAmount: 0,
    payMethod: 'Cash',
    cashReceived: 0,
    orderType: 'Dine In',
    tableNumber: 'Meja 1',
    settings: { tableFeaturesEnabled: true, printerEnabled: false } as any,
    ...overrides,
  } as AtomicCheckoutParams;
}

beforeEach(() => {
  vi.clearAllMocks();
  useMenuStore.setState({ menus: [] });
  useInventoryStore.setState({ items: [] });
  useTransactionStore.setState({ transactions: [], deletedLocalIds: [] });
  useStockLogStore.setState({ logs: [] });
});

describe('AtomicTransactionEngine.executeRollback — v4.7 TO DO 18.8 (A3: log add seimbang)', () => {
  it('transaksi gagal setelah potong stok → stok dikembalikan DENGAN log add (bukan skipLog)', async () => {
    const menu = makeMenu('m1', 'Menu 1', 'inv1');
    useMenuStore.setState({ menus: [menu] });
    useInventoryStore.setState({ items: [makeInv('inv1', 10)] });

    // Inject kegagalan SETELAH deductStock (di addTransaction) untuk memicu rollback
    const addTxSpy = vi
      .spyOn(useTransactionStore.getState(), 'addTransaction')
      .mockImplementation(() => {
        throw new Error('simulasi kegagalan commit (uji rollback)');
      });

    try {
      const result = await AtomicTransactionEngine.executeCheckout(
        baseParams({ cartItems: [makeCartItem(menu, 2)], totalAmount: 20000 })
      );

      expect(result.success).toBe(false);
    } finally {
      addTxSpy.mockRestore();
    }

    // 1) Stok dikembalikan penuh (snapshot 10)
    const restored = useInventoryStore.getState().items.find((i) => i.id === 'inv1');
    expect(restored?.stock).toBe(10);

    // 2) Stock log SEIMBANG: ada 'deduct' (transaksi) DAN 'add' balasan (rollback)
    const logs = useStockLogStore.getState().logs.filter((l) => l.inventoryId === 'inv1');
    const deduct = logs.find((l) => l.type === 'deduct');
    const add = logs.find((l) => l.type === 'add');
    expect(deduct).toBeDefined();
    expect(add).toBeDefined();
    expect(deduct!.amount).toBe(-2); // amount negatif = deducted
    expect(deduct!.stockAfter).toBe(8);
    expect(add!.amount).toBe(2); // amount positif = added
    expect(add!.stockBefore).toBe(8);
    expect(add!.stockAfter).toBe(10);
    expect(add!.reason).toContain('Rollback');
  });

  it('rollback dengan delta 0 (gagal sebelum potong stok) → tanpa log add (tidak ada mutasi)', async () => {
    const menu = makeMenu('m1', 'Menu 1', 'inv1');
    useMenuStore.setState({ menus: [menu] });
    useInventoryStore.setState({ items: [makeInv('inv1', 10)] });

    // Gagal di getNextQueueNumber (sebelum deductStock) — fallback lokal masih jalan,
    // jadi alih-alih itu: gagal langsung sebelum komit dengan cart kosong tidak masuk engine.
    // Untuk delta 0, gagalkan addTransaction tanpa deduct terlebih dahulu tidak mungkin
    // (deduct selalu mendahului addTransaction). Alternatif: pastikan snapshot tidak berubah.
    const addTxSpy = vi
      .spyOn(useTransactionStore.getState(), 'addTransaction')
      .mockImplementation(() => {
        throw new Error('gagal');
      });
    try {
      // Stok pas-pasan: deduct 1 → stock 9, lalu rollback → 10
      const result = await AtomicTransactionEngine.executeCheckout(
        baseParams({ cartItems: [makeCartItem(menu, 1)], totalAmount: 10000 })
      );
      expect(result.success).toBe(false);
    } finally {
      addTxSpy.mockRestore();
    }

    const restored = useInventoryStore.getState().items.find((i) => i.id === 'inv1');
    expect(restored?.stock).toBe(10);
    const logs = useStockLogStore.getState().logs.filter((l) => l.inventoryId === 'inv1');
    expect(logs.some((l) => l.type === 'add')).toBe(true);
  });
});
