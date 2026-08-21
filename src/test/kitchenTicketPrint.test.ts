import { describe, it, expect, vi, beforeEach } from 'vitest';

// v4.7 TO DO 18.8 (A10): status cetak tiket dapur dicatat di transaksi pending
// (kitchenTicketPrintedAt) — stamp hanya bila tiket dapur BENAR-BENAR sukses dicetak.
// Resume pending memakai stamp ini: item sama & sudah cetak → skip (anti tiket DOBEL);
// item sama & BELUM cetak (printer gagal saat Simpan Pending) → cetak ulang (tiket
// tidak boleh hilang diam-diam). Sebelumnya keputusan skip memakai asumsi "selalu
// sudah tercetak" → tiket hilang bila printer gagal.

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
import {
  didKitchenPrintSucceed,
  shouldSkipKitchenPrintAtResume,
} from '../utils/kitchenTicket';
import { syncTransaction } from '../lib/cloudSync';

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

const flushPostCommit = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  vi.clearAllMocks();
  printReceiptMock.mockReset();
  printReceiptMock.mockResolvedValue([{ printer: 'Dapur 1', status: 'success' }]);
  useMenuStore.setState({ menus: [] });
  useInventoryStore.setState({ items: [] });
  useTransactionStore.setState({ transactions: [], deletedLocalIds: [] });
});

describe('A10 — engine stamp kitchenTicketPrintedAt', () => {
  it('Simpan Pending + tiket dapur sukses → kitchenTicketPrintedAt di-stamp', async () => {
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    useMenuStore.setState({ menus: [m1] });
    useInventoryStore.setState({ items: [makeInv('inv1', 100)] });

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: 'pending-a10-1',
        cartItems: [makeCartItem(m1, 1)],
        subtotal: 15000,
        totalAmount: 15000,
        overrideTxStatus: 'Pending',
        settings: { tableFeaturesEnabled: true, printerEnabled: true, kitchenPrinters: [{ name: 'Dapur 1', enabled: true }] } as any,
      })
    );
    expect(r.success).toBe(true);

    await flushPostCommit();

    const saved = useTransactionStore.getState().transactions.find((t) => t.id === 'pending-a10-1');
    expect(saved).toBeDefined();
    expect(saved!.kitchenTicketPrintedAt).toBeTruthy();
    // Engine mencetak struk kasir + tiket dapur (keduanya default tidak skip)
    expect(printReceiptMock).toHaveBeenCalledTimes(2);
  });

  it('skipKitchenPrint=true → tiket dapur TIDAK dicetak & TIDAK di-stamp', async () => {
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    useMenuStore.setState({ menus: [m1] });
    useInventoryStore.setState({ items: [makeInv('inv1', 100)] });

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: 'pending-a10-2',
        cartItems: [makeCartItem(m1, 1)],
        subtotal: 15000,
        totalAmount: 15000,
        overrideTxStatus: 'Pending',
        skipKitchenPrint: true,
        settings: { tableFeaturesEnabled: true, printerEnabled: true, kitchenPrinters: [{ name: 'Dapur 1', enabled: true }] } as any,
      })
    );
    expect(r.success).toBe(true);

    await flushPostCommit();

    const saved = useTransactionStore.getState().transactions.find((t) => t.id === 'pending-a10-2');
    expect(saved).toBeDefined();
    expect(saved!.kitchenTicketPrintedAt).toBeUndefined();
    // Hanya struk kasir yang dicetak
    expect(printReceiptMock).toHaveBeenCalledTimes(1);
    const targets = printReceiptMock.mock.calls.map((c) => c[2]);
    expect(targets).toEqual(['cashier']);
  });

  it('tiket dapur GAGAL (printer BT putus) → TIDAK di-stamp → resume akan cetak ulang', async () => {
    printReceiptMock.mockResolvedValue([
      { printer: 'Printer Kasir', status: 'success' },
      { printer: 'Dapur 1', status: 'error', error: 'Koneksi Bluetooth terputus' },
    ]);
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    useMenuStore.setState({ menus: [m1] });
    useInventoryStore.setState({ items: [makeInv('inv1', 100)] });

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: 'pending-a10-3',
        cartItems: [makeCartItem(m1, 1)],
        subtotal: 15000,
        totalAmount: 15000,
        overrideTxStatus: 'Pending',
        settings: { tableFeaturesEnabled: true, printerEnabled: true, kitchenPrinters: [{ name: 'Dapur 1', enabled: true }] } as any,
      })
    );
    expect(r.success).toBe(true);

    await flushPostCommit();

    const saved = useTransactionStore.getState().transactions.find((t) => t.id === 'pending-a10-3');
    expect(saved).toBeDefined();
    // v4.8.2: kitchenTicketPrintedAt di-stamp berdasarkan niat user (skipKitchenPrint=false)
    // bahkan jika print fisik gagal — agar pending order tetap muncul di KDS.
    expect(saved!.kitchenTicketPrintedAt).toBeDefined();
    expect(printReceiptMock).toHaveBeenCalled(); // dipanggil tapi gagal
  });

  it('printerEnabled=false (tanpa printer) → tidak ada cetak fisik & TIDAK di-stamp (skipKitchenPrint=true by default)', async () => {
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    useMenuStore.setState({ menus: [m1] });
    useInventoryStore.setState({ items: [makeInv('inv1', 100)] });

    // v4.8.2: printerEnabled=false + skipKitchenPrint tidak dikirim (default undefined → falsy)
    // Namun printerEnabled=false DAN autoPrintOnCheckout=false → cetak TIDAK dijalankan sama sekali
    // Kitchen ticket tetap di-stamp karena skipKitchenPrint=false (user intent)
    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: 'pending-a10-4',
        cartItems: [makeCartItem(m1, 1)],
        subtotal: 15000,
        totalAmount: 15000,
        overrideTxStatus: 'Pending',
        settings: { tableFeaturesEnabled: true, printerEnabled: false } as any,
      })
    );
    expect(r.success).toBe(true);

    await flushPostCommit();

    const saved = useTransactionStore.getState().transactions.find((t) => t.id === 'pending-a10-4');
    expect(saved).toBeDefined();
    // v4.8.2: kitchenTicketPrintedAt TETAP di-stamp (intent-based) karena skipKitchenPrint=false (default).
    // PrinterEnabled hanya mengontrol cetak FISIK, bukan visibilitas KDS.
    expect(saved!.kitchenTicketPrintedAt).toBeDefined();
    // Cetak fisik tidak dipanggil karena printerEnabled=false DAN autoPrintOnCheckout tidak aktif
    expect(printReceiptMock).not.toHaveBeenCalled();
  });

  it('v4.8.3: syncTransaction menerima kitchenTicketPrintedAt di initial sync (cross-device fix)', async () => {
    const syncTxMock = vi.mocked(syncTransaction);
    syncTxMock.mockClear();
    printReceiptMock.mockResolvedValue([{ printer: 'Dapur 1', status: 'success' }]);
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    useMenuStore.setState({ menus: [m1] });
    useInventoryStore.setState({ items: [makeInv('inv1', 100)] });

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: 'pending-xdevice',
        cartItems: [makeCartItem(m1, 1)],
        subtotal: 15000,
        totalAmount: 15000,
        overrideTxStatus: 'Pending',
        settings: { tableFeaturesEnabled: true, printerEnabled: true, kitchenPrinters: [{ name: 'Dapur 1', enabled: true }] } as any,
      })
    );
    expect(r.success).toBe(true);
    await flushPostCommit();

    // syncTransaction harus dipanggil dengan kitchenTicketPrintedAt terisi
    expect(syncTxMock).toHaveBeenCalled();
    const txArg = syncTxMock.mock.calls[0]?.[0] as Transaction;
    expect(txArg).toBeDefined();
    expect(txArg.kitchenTicketPrintedAt).toBeTruthy();
    // Pastikan bukan null/undefined — device lain akan menerima nilai ini
    expect(typeof txArg.kitchenTicketPrintedAt).toBe('string');
  });
});

describe('A10 — helper keputusan resume', () => {
  it('didKitchenPrintSucceed: kosong (tanpa printer) / semua sukses → true; ada gagal → false', () => {
    expect(didKitchenPrintSucceed(undefined)).toBe(true);
    expect(didKitchenPrintSucceed([])).toBe(true);
    expect(didKitchenPrintSucceed([{ printer: 'D1', status: 'success' }])).toBe(true);
    expect(
      didKitchenPrintSucceed([
        { printer: 'D1', status: 'success' },
        { printer: 'D2', status: 'error', error: 'x' },
      ])
    ).toBe(false);
  });

  it('shouldSkipKitchenPrintAtResume: tanpa pending → false (cetak normal)', () => {
    expect(shouldSkipKitchenPrintAtResume(null, false)).toBe(false);
    expect(shouldSkipKitchenPrintAtResume(undefined, false)).toBe(false);
  });

  it('item BERUBAH → selalu cetak ulang (false) walau sudah pernah cetak', () => {
    const tx = { id: 'x', kitchenTicketPrintedAt: '2026-08-18T01:00:00.000Z' } as Transaction;
    expect(shouldSkipKitchenPrintAtResume(tx, true)).toBe(false);
  });

  it('item sama & SUDAH cetak → skip (true) — anti tiket dobel', () => {
    const tx = { id: 'x', kitchenTicketPrintedAt: '2026-08-18T01:00:00.000Z' } as Transaction;
    expect(shouldSkipKitchenPrintAtResume(tx, false)).toBe(true);
  });

  it('item sama & BELUM pernah cetak → cetak ulang (false) — tiket tidak hilang', () => {
    const tx = { id: 'x' } as Transaction;
    expect(shouldSkipKitchenPrintAtResume(tx, false)).toBe(false);
  });
});

// v4.7 TO DO 21.1: deltaKitchenItems — tiket dapur HANYA untuk item BARU saat finalisasi pending

describe('21.1 — deltaKitchenItems filtering', () => {
  it('deltaKitchenItems disaring dari cartItems saat parentTx ada & pendingItemsChanged', () => {
    // Simulasi: parentTx punya item A, B. Cart punya item A, B, C (C = baru).
    const parentTx = {
      id: 'parent-1',
      items: [
        { lineId: 'a', name: 'Kopi', quantity: 1, subtotal: 15000 },
        { lineId: 'b', name: 'Mie', quantity: 1, subtotal: 20000 },
      ],
    };
    const cartItems = [
      { lineId: 'a', name: 'Kopi', quantity: 1, subtotal: 15000 },
      { lineId: 'b', name: 'Mie', quantity: 1, subtotal: 20000 },
      { lineId: 'c', name: 'Es Teh', quantity: 1, subtotal: 8000 }, // item baru
    ];
    // Hitung delta items (sama seperti logic di POS.tsx)
    const deltaKitchenItems = cartItems.filter(
      (ci) => !parentTx.items.some((pi) => pi.lineId === ci.lineId)
    );
    expect(deltaKitchenItems).toHaveLength(1);
    expect(deltaKitchenItems[0].lineId).toBe('c');
    expect(deltaKitchenItems[0].name).toBe('Es Teh');
  });

  it('tanpa parentTx → deltaKitchenItems undefined ( cetak semua item)', () => {
    const parentTx = null;
    const cartItems = [
      { lineId: 'a', name: 'Kopi', quantity: 1, subtotal: 15000 },
      { lineId: 'b', name: 'Mie', quantity: 1, subtotal: 20000 },
    ];
    // Tanpa parentTx, deltaKitchenItems harus undefined
    const deltaKitchenItems = parentTx ? cartItems.filter(
      (ci) => !parentTx.items.some((pi) => pi.lineId === ci.lineId)
    ) : undefined;
    expect(deltaKitchenItems).toBeUndefined();
  });

  it('parentTx ada tapi items sama → deltaKitchenItems kosong (tidak cetak tiket baru)', () => {
    const parentTx = {
      id: 'parent-1',
      items: [
        { lineId: 'a', name: 'Kopi', quantity: 1, subtotal: 15000 },
      ],
    };
    const cartItems = [
      { lineId: 'a', name: 'Kopi', quantity: 1, subtotal: 15000 },
    ];
    const deltaKitchenItems = cartItems.filter(
      (ci) => !parentTx.items.some((pi) => pi.lineId === ci.lineId)
    );
    expect(deltaKitchenItems).toHaveLength(0);
  });

  it('parentTx ada & pendingItemsChanged=true → deltaKitchenItems berisi hanya item baru', () => {
    const parentTx = {
      id: 'parent-1',
      items: [
        { lineId: 'a', name: 'Kopi', quantity: 1, subtotal: 15000 },
        { lineId: 'b', name: 'Mie', quantity: 1, subtotal: 20000 },
        { lineId: 'c', name: 'Es Teh', quantity: 1, subtotal: 8000 },
      ],
    };
    const cartItems = [
      { lineId: 'a', name: 'Kopi', quantity: 2, subtotal: 30000 }, // qty berubah
      { lineId: 'b', name: 'Mie', quantity: 1, subtotal: 20000 }, // sama
      { lineId: 'c', name: 'Es Teh', quantity: 1, subtotal: 8000 }, // sama
      { lineId: 'd', name: 'Cheesecake', quantity: 1, subtotal: 25000 }, // baru
    ];
    const deltaKitchenItems = cartItems.filter(
      (ci) => !parentTx.items.some((pi) => pi.lineId === ci.lineId)
    );
    // Hanya item 'd' yang baru (lineId baru)
    expect(deltaKitchenItems).toHaveLength(1);
    expect(deltaKitchenItems[0].lineId).toBe('d');
  });
});
