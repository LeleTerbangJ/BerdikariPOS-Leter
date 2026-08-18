import { describe, it, expect, vi, beforeEach } from 'vitest';

// v4.7 TO DO 18.8 (A13): jalur pembuatan transaksi DEMO dari POS.
// Sebelumnya Demo hanya bisa dicapai via transisi status Selesai→Demo di Transactions
// (yang me-revert stok). Sekarang POS bisa mencatat demo langsung: engine TIDAK memotong
// stok (bukan penjualan nyata), TIDAK mengonsumsi nomor antrean (queueNumber 0, Demo
// dikecualikan dari hitungan & laporan), dan print di-suppress (dapur tidak menerima tiket).

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

const printReceiptMock = vi.fn();
vi.mock('../utils/printer', () => ({
  printReceipt: (...args: unknown[]) => printReceiptMock(...args),
  buildReceiptFromTransaction: vi.fn(() => ({})),
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
  printReceiptMock.mockReset();
  printReceiptMock.mockResolvedValue([{ printer: 'Dapur 1', status: 'success' }]);
  useMenuStore.setState({ menus: [] });
  useInventoryStore.setState({ items: [] });
  useTransactionStore.setState({ transactions: [], deletedLocalIds: [] });
});

describe('A13 — pembuatan transaksi Demo (overrideTxStatus: Demo)', () => {
  it('Demo TIDAK memotong stok & queueNumber = 0 (tidak konsumsi nomor antrean)', async () => {
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    useMenuStore.setState({ menus: [m1] });
    useInventoryStore.setState({ items: [makeInv('inv1', 10)] });

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: 'demo-1',
        cartItems: [makeCartItem(m1, 2)],
        subtotal: 30000,
        totalAmount: 30000,
        overrideTxStatus: 'Demo',
        suppressAutoPrint: true,
      })
    );
    expect(r.success).toBe(true);

    const tx = r.transaction as Transaction;
    expect(tx.txStatus).toBe('Demo');
    expect(tx.isPending).toBe(false);
    expect(tx.queueNumber).toBe(0);

    // Stok TIDAK berubah (tidak ada deduct)
    expect(useInventoryStore.getState().items.find((i) => i.id === 'inv1')?.stock).toBe(10);
    // getNextQueueNumber TIDAK dipanggil (tidak alokasi nomor antrean)
    expect(useTransactionStore.getState().transactions.find((t) => t.id === 'demo-1')).toBeDefined();
    // Tidak ada cetakan (suppressAutoPrint + demo)
    expect(printReceiptMock).not.toHaveBeenCalled();
  });

  it('Demo tetap merekam item (snapshot resep) agar bisa di-ubah ke Selesai nanti (8.1)', async () => {
    const m1 = makeMenu('m1', 'Es Teh', 5000, 'inv2');
    useMenuStore.setState({ menus: [m1] });
    useInventoryStore.setState({ items: [makeInv('inv2', 100)] });

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: 'demo-2',
        cartItems: [makeCartItem(m1, 1)],
        subtotal: 5000,
        totalAmount: 5000,
        overrideTxStatus: 'Demo',
        suppressAutoPrint: true,
      })
    );
    expect(r.success).toBe(true);
    const tx = r.transaction as Transaction;
    expect(tx.items).toHaveLength(1);
    expect(tx.items[0].name).toBe('Es Teh');
  });

  it('checkout NORMAL tetap memotong stok (sanity — perilaku lama tidak berubah)', async () => {
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    useMenuStore.setState({ menus: [m1] });
    useInventoryStore.setState({ items: [makeInv('inv1', 10)] });

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: 'normal-1',
        cartItems: [makeCartItem(m1, 2)],
        subtotal: 30000,
        totalAmount: 30000,
        overrideTxStatus: 'Selesai',
      })
    );
    expect(r.success).toBe(true);
    expect(useInventoryStore.getState().items.find((i) => i.id === 'inv1')?.stock).toBe(8);
    expect((r.transaction as Transaction).queueNumber).toBeGreaterThan(0);
  });
});
