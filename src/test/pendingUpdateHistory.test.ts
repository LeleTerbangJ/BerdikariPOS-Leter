import { describe, it, expect, vi, beforeEach } from 'vitest';

// v4.7 REGRESI (bug: item pending tidak ter-update di riwayat transaksi):
// membuktikan alur LOKAL engine benar — re-commit pending dengan ID yang sama
// (bypassIdempotency) melakukan upsert by ID di store, sehingga item yang
// ditambah/dikurangi langsung tercermin di riwayat transaksi. Pasangan test ini
// dengan pendingCloudOverwrite.test.ts yang menutup sisi round-trip cloud.

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

function makeMenu(id: string, name: string, price: number, ingredientInv: string): Menu {
  return {
    id,
    name,
    category: 'Makanan',
    price,
    ingredients: { [ingredientInv]: 1 },
    availableAddons: [],
  } as Menu;
}

function makeInv(id: string, stock: number): InventoryItem {
  return {
    id,
    name: id,
    unit: 'pcs',
    stock,
    minStock: 0,
  } as InventoryItem;
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
});

describe('REPRO: update pending items reflected in history', () => {
  it('update pending (add item) → riwayat transaksi memuat item baru', async () => {
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    const m2 = makeMenu('m2', 'Es Teh', 5000, 'inv2');
    useMenuStore.setState({ menus: [m1, m2] });
    useInventoryStore.setState({ items: [makeInv('inv1', 100), makeInv('inv2', 100)] });

    // 1. Simpan pending [A]
    const pendingTxId = 'pending-1';
    const r1 = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: pendingTxId,
        cartItems: [makeCartItem(m1, 1)],
        subtotal: 15000,
        totalAmount: 15000,
        overrideTxStatus: 'Pending',
      })
    );
    expect(r1.success).toBe(true);
    expect(useTransactionStore.getState().transactions.find((t) => t.id === pendingTxId)?.items).toHaveLength(1);

    // 2. Update pending — tambah item B (resume lalu Simpan Pending lagi)
    const r2 = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: pendingTxId,
        cartItems: [makeCartItem(m1, 1), makeCartItem(m2, 1)],
        subtotal: 20000,
        totalAmount: 20000,
        overrideTxStatus: 'Pending',
        bypassIdempotency: true,
        reservedDeductions: { inv1: 1 },
      })
    );
    expect(r2.success).toBe(true);
    const itemsAfter = useTransactionStore.getState().transactions.find((t) => t.id === pendingTxId)?.items;
    expect(itemsAfter).toHaveLength(2);
    expect(itemsAfter?.map((i) => i.name)).toEqual(['Nasi Goreng', 'Es Teh']);
  });

  it('update pending (hapus item + tambah item) → riwayat mencerminkan perubahan', async () => {
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    const m2 = makeMenu('m2', 'Es Teh', 5000, 'inv2');
    const m3 = makeMenu('m3', 'Ayam Geprek', 18000, 'inv3');
    useMenuStore.setState({ menus: [m1, m2, m3] });
    useInventoryStore.setState({ items: [makeInv('inv1', 100), makeInv('inv2', 100), makeInv('inv3', 100)] });

    const pendingTxId = 'pending-2';
    const r1 = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: pendingTxId,
        cartItems: [makeCartItem(m1, 1), makeCartItem(m2, 1)],
        subtotal: 20000,
        totalAmount: 20000,
        overrideTxStatus: 'Pending',
      })
    );
    expect(r1.success).toBe(true);

    // Update: hapus Es Teh (m2), tambah Ayam Geprek (m3)
    const r2 = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: pendingTxId,
        cartItems: [makeCartItem(m1, 1), makeCartItem(m3, 1)],
        subtotal: 33000,
        totalAmount: 33000,
        overrideTxStatus: 'Pending',
        bypassIdempotency: true,
        reservedDeductions: { inv1: 1, inv2: 1 },
      })
    );
    expect(r2.success).toBe(true);
    const itemsAfter = useTransactionStore.getState().transactions.find((t) => t.id === pendingTxId)?.items;
    expect(itemsAfter?.map((i) => i.name).sort()).toEqual(['Ayam Geprek', 'Nasi Goreng']);
  });

  it('finalize pending dengan item berubah → riwayat Selesai memuat item baru', async () => {
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    const m2 = makeMenu('m2', 'Es Teh', 5000, 'inv2');
    useMenuStore.setState({ menus: [m1, m2] });
    useInventoryStore.setState({ items: [makeInv('inv1', 100), makeInv('inv2', 100)] });

    const pendingTxId = 'pending-3';
    await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: pendingTxId,
        cartItems: [makeCartItem(m1, 1)],
        subtotal: 15000,
        totalAmount: 15000,
        overrideTxStatus: 'Pending',
      })
    );

    // Finalize: resume dengan tambahan Es Teh, status Selesai
    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: pendingTxId,
        cartItems: [makeCartItem(m1, 1), makeCartItem(m2, 2)],
        subtotal: 25000,
        totalAmount: 25000,
        overrideTxStatus: 'Selesai',
        bypassIdempotency: true,
        reservedDeductions: { inv1: 1 },
      })
    );
    expect(r.success).toBe(true);
    const tx = useTransactionStore.getState().transactions.find((t) => t.id === pendingTxId);
    expect(tx?.txStatus).toBe('Selesai');
    expect(tx?.items).toHaveLength(2);
    expect(tx?.items.find((i) => i.menuId === 'm2')?.quantity).toBe(2);
  });
});
