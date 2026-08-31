// ============================================================
// v4.10 P.4 — ITEM NON-MENU / CUSTOM: TEST INTEGRASI END-TO-END
//
// Jalur yang diuji (semua memakai AtomicTransactionEngine + store
// nyata, mengikuti pola demoTransaction.test.ts / pendingResumeContext.test.ts):
//   1. Checkout NORMAL (Selesai)    — stok tidak tersentuh untuk item custom,
//      item menu di cart yang sama tetap terpotong & di-refund/revert benar.
//   2. Simpan Pending + Resume      — tidak ada reserve stok utk custom;
//      finalize delta-tidak-menyentuh; tetap 1 transaksi (no duplikat).
//   3. Refund                       — revert hanya bahan menu; custom tidak
//      menimbulkan revert & guard double-refund tetap berlaku.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  syncStockLogsBulk: vi.fn().mockResolvedValue(true),
  syncAuditLog: vi.fn().mockResolvedValue(true),
  fetchAuditLogsFromCloud: vi.fn().mockResolvedValue([]),
}));

vi.mock('../utils/printer', () => ({
  printReceipt: vi.fn().mockResolvedValue([{ printer: 'Dapur 1', status: 'success' }]),
  buildReceiptFromTransaction: vi.fn(() => ({})),
}));

import type { Transaction, CartItem, Menu, InventoryItem, AtomicCheckoutParams } from '../types';
import { AtomicTransactionEngine } from '../lib/atomicTransactionEngine';
import { useMenuStore } from '../store/menuStore';
import { useInventoryStore } from '../store/inventoryStore';
import { useTransactionStore } from '../store/transactionStore';
import { useCartStore } from '../store/cartStore';
import { resolveResumeRestore } from '../utils/pendingResume';
import { calculateItemDeductions } from '../utils/hpp';
import { canExecuteRefund } from '../utils/refund';
import { CUSTOM_MENU_ID_PREFIX } from '../utils/customItem';

function makeMenu(id: string, name: string, price: number, ingredients: Record<string, number>): Menu {
  return {
    id,
    name,
    category: 'Makanan',
    price,
    ingredients,
    availableAddons: [],
  } as Menu;
}

function makeInv(id: string, stock: number): InventoryItem {
  return { id, name: id, unit: 'pcs', stock, minStock: 0 } as InventoryItem;
}

function makeMenuCartItem(menu: Menu, qty: number): CartItem {
  return {
    lineId: `${menu.id}-${qty}-${Math.random().toString(36).slice(2, 8)}`,
    menuId: menu.id,
    name: menu.name,
    basePrice: menu.price,
    quantity: qty,
    temperature: 'Dingin',
    sugar: 'Normal',
    addons: [],
    subtotal: menu.price * qty,
  };
}

function makeCustomItem(name: string, price: number, qty: number): CartItem {
  return {
    lineId: `custom-${Math.random().toString(36).slice(2, 8)}`,
    menuId: `${CUSTOM_MENU_ID_PREFIX}${Math.random().toString(36).slice(2, 12)}`,
    name,
    basePrice: price,
    quantity: qty,
    temperature: 'Hangat',
    sugar: 'None',
    addons: [],
    subtotal: price * qty,
    isCustom: true,
  };
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

const stockOf = (id: string) => useInventoryStore.getState().items.find((i) => i.id === id)?.stock;

beforeEach(() => {
  vi.clearAllMocks();
  useMenuStore.setState({ menus: [] });
  useInventoryStore.setState({ items: [] });
  useTransactionStore.setState({ transactions: [], deletedLocalIds: [] });
  useCartStore.setState({ items: [], discount: 0, resumeContext: null });
});

// ============================================================
// 1. CHECKOUT NORMAL — stok custom tidak tersentuh
// ============================================================
describe('P.4 integrasi — checkout normal (Selesai)', () => {
  it('menu + custom: stok terpotong HANYA untuk bahan menu; item custom terekam ber-flag isCustom, HPP 0, tanpa snapshot bahan', async () => {
    const esTeh = makeMenu('m1', 'Es Teh', 5000, { gula: 2, teh: 1 });
    useMenuStore.setState({ menus: [esTeh] });
    useInventoryStore.setState({ items: [makeInv('gula', 10), makeInv('teh', 5)] });

    const menuItem = makeMenuCartItem(esTeh, 2); // butuh gula 4 + teh 2
    const sambal = makeCustomItem('Sambal', 10000, 3); // 30.000

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: 'tx-mixed-1',
        cartItems: [menuItem, sambal],
        subtotal: 10000 + 30000,
        totalAmount: 40000,
        overrideTxStatus: 'Selesai',
      })
    );
    expect(r.success).toBe(true);

    // Stok: HANYA bahan menu yang terpotong — custom tidak menyentuh apa pun
    expect(stockOf('gula')).toBe(6);
    expect(stockOf('teh')).toBe(3);

    const tx = r.transaction as Transaction;
    expect(tx.items).toHaveLength(2);

    const customLine = tx.items.find((i) => i.isCustom)!;
    expect(customLine.name).toBe('Sambal');
    expect(customLine.menuId.startsWith(CUSTOM_MENU_ID_PREFIX)).toBe(true);
    expect(customLine.recipeSnapshot).toEqual([]); // tanpa resep → tanpa deduksi
    expect(customLine.hpp).toBe(0);
    expect(customLine.cogs).toBe(0);
    expect(customLine.subtotal).toBe(30000);

    const menuLine = tx.items.find((i) => i.menuId === 'm1')!;
    expect(menuLine.recipeSnapshot).toHaveLength(2); // gula + teh (snapshot tetap utuh)

    // Total HPP transaksi = HPP menu saja (custom 0)
    expect(tx.hpp).toBe(menuLine.hpp!);
    expect(tx.queueNumber).toBeGreaterThan(0); // transaksi normal tetap konsumsi antrean
  });

  it('custom-only cart: stok TIDAK berubah sama sekali walau qty besar', async () => {
    useInventoryStore.setState({ items: [makeInv('gula', 7)] });

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: 'tx-custom-only-1',
        cartItems: [
          makeCustomItem('Kerupuk', 2000, 10),
          makeCustomItem('Es Batu', 1000, 5),
        ],
        subtotal: 20000 + 5000,
        totalAmount: 25000,
        overrideTxStatus: 'Selesai',
      })
    );
    expect(r.success).toBe(true);

    expect(stockOf('gula')).toBe(7);
    expect((r.transaction as Transaction).hpp).toBe(0);
    expect((r.transaction as Transaction).items.every((i) => i.isCustom)).toBe(true);
  });
});

// ============================================================
// 2. SIMPAN PENDING + RESUME — reserve & delta tidak menyentuh stok custom
// ============================================================
describe('P.4 integrasi — pending + resume', () => {
  /**
   * Simulasi alur POS: simpan pending via engine → resume ke keranjang
   * (clear → addItem → setResumeContext) → restore identitas via
   * resolveResumeRestore → finalize dengan ID pending yang sama.
   */
  async function savePendingAndResume(pendingTxId: string, items: CartItem[]) {
    await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: pendingTxId,
        cartItems: items,
        subtotal: items.reduce((a, b) => a + b.subtotal, 0),
        totalAmount: items.reduce((a, b) => a + b.subtotal, 0),
        overrideTxStatus: 'Pending',
        pendingNotes: 'Pesanan Gantung POS',
        suppressAutoPrint: true,
      })
    );
    const tx = useTransactionStore.getState().transactions.find((t) => t.id === pendingTxId)!;
    tx.items.forEach((item) => useCartStore.getState().addItem(item));
    useCartStore.getState().setResumeContext({
      id: tx.id,
      queueNumber: tx.queueNumber,
      kitchenStatus: tx.kitchenStatus,
    });
    return tx;
  }

  it('custom-only: simpan pending TIDAK menahan stok; resume+finalize tetap tanpa potong & 1 transaksi', async () => {
    useInventoryStore.setState({ items: [makeInv('gula', 10)] });
    const sambal = makeCustomItem('Sambal', 10000, 2);

    const pendingTx = await savePendingAndResume('pending-custom-1', [sambal]);
    expect(pendingTx.isPending).toBe(true);
    expect(stockOf('gula')).toBe(10); // pending TIDAK me-reserve stok untuk item custom

    // Resume: restore identitas pending (perilaku POS — anti transaksi duplikat)
    const { tx: restored, stale } = resolveResumeRestore(
      useCartStore.getState().resumeContext,
      useCartStore.getState().items,
      useTransactionStore.getState().transactions
    );
    expect(stale).toBe(false);
    expect(restored?.id).toBe('pending-custom-1');

    // Finalize: reservedDeductions = deduksi PENDING (untuk custom = {} → delta 0)
    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: restored!.id,
        cartItems: [sambal],
        subtotal: sambal.subtotal,
        totalAmount: sambal.subtotal,
        overrideTxStatus: 'Selesai',
        bypassIdempotency: true,
        overrideQueueNumber: pendingTx.queueNumber,
        reservedDeductions: calculateItemDeductions(pendingTx.items, useMenuStore.getState().menus),
      })
    );
    expect(r.success).toBe(true);

    // Stok tetap tidak tersentuh di SEMUA fase (simpan → resume → finalize)
    expect(stockOf('gula')).toBe(10);

    const txs = useTransactionStore.getState().transactions;
    expect(txs).toHaveLength(1); // pending di-update, bukan transaksi baru
    expect(txs[0].txStatus).toBe('Selesai');
    expect(txs[0].isPending).toBe(false);
    expect(txs[0].queueNumber).toBe(pendingTx.queueNumber);
  });

  it('campuran menu+custom: pending me-reserve HANYA bahan menu; delta finalize tidak menyentuh stok', async () => {
    const esTeh = makeMenu('m1', 'Es Teh', 5000, { gula: 2, teh: 1 });
    useMenuStore.setState({ menus: [esTeh] });
    useInventoryStore.setState({ items: [makeInv('gula', 10), makeInv('teh', 5)] });

    const menuItem = makeMenuCartItem(esTeh, 2); // gula 4 + teh 2
    const sambal = makeCustomItem('Sambal', 10000, 3);

    const pendingTx = await savePendingAndResume('pending-mixed-1', [menuItem, sambal]);

    // Simpan pending: reserve penuh HANYA untuk bahan menu (custom tidak ikut reserve)
    expect(stockOf('gula')).toBe(6);
    expect(stockOf('teh')).toBe(3);

    // Finalize cart yang TIDAK berubah → delta 0 untuk bahan menu, 0 untuk custom
    const cartItems = useCartStore.getState().items;
    const { tx: restored } = resolveResumeRestore(
      useCartStore.getState().resumeContext,
      cartItems,
      useTransactionStore.getState().transactions
    );
    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: restored!.id,
        cartItems,
        subtotal: cartItems.reduce((a, b) => a + b.subtotal, 0),
        totalAmount: cartItems.reduce((a, b) => a + b.subtotal, 0),
        overrideTxStatus: 'Selesai',
        bypassIdempotency: true,
        overrideQueueNumber: pendingTx.queueNumber,
        reservedDeductions: calculateItemDeductions(pendingTx.items, useMenuStore.getState().menus),
      })
    );
    expect(r.success).toBe(true);

    // Stok final: sama dengan setelah reserve — tidak ada potong ganda / revert palsu utk custom
    expect(stockOf('gula')).toBe(6);
    expect(stockOf('teh')).toBe(3);

    const txs = useTransactionStore.getState().transactions;
    expect(txs).toHaveLength(1);
    expect(txs[0].items).toHaveLength(2);
    expect(txs[0].items.some((i) => i.isCustom)).toBe(true);
  });

  it('RESUME + EDIT CART: tambah menu baru & ubah qty item custom → delta stok HANYA selisih bahan menu, custom netral', async () => {
    const esTeh = makeMenu('m1', 'Es Teh', 5000, { gula: 2, teh: 1 });
    const kopi = makeMenu('m2', 'Kopi', 8000, { kopi: 1 });
    useMenuStore.setState({ menus: [esTeh, kopi] });
    useInventoryStore.setState({ items: [makeInv('gula', 10), makeInv('teh', 5), makeInv('kopi', 8)] });

    // PENDING: m1 qty 2 (gula 4 + teh 2) + custom "Sambal" qty 3 → reserve HANYA bahan menu
    const pendingTx = await savePendingAndResume('pending-edit-1', [
      makeMenuCartItem(esTeh, 2),
      makeCustomItem('Sambal', 10000, 3),
    ]);
    expect(pendingTx.isPending).toBe(true);
    expect(stockOf('gula')).toBe(6);
    expect(stockOf('teh')).toBe(3);
    expect(stockOf('kopi')).toBe(8); // custom & m2 belum menyentuh stok

    // RESUME + EDIT: qty m1 2→3, TAMBAH m2 qty 1, qty custom 3→5 (harga sama)
    const editedItems = [
      makeMenuCartItem(esTeh, 3),       // gula 6, teh 3 (delta +gula 2, +teh 1)
      makeMenuCartItem(kopi, 1),        // kopi 1 (baru → delta +kopi 1)
      makeCustomItem('Sambal', 10000, 5), // custom diedit qty — TIDAK boleh memicu stok apa pun
    ];

    const { tx: restored } = resolveResumeRestore(
      useCartStore.getState().resumeContext,
      editedItems,
      useTransactionStore.getState().transactions
    );
    expect(restored?.id).toBe('pending-edit-1');

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: restored!.id,
        cartItems: editedItems,
        subtotal: editedItems.reduce((a, b) => a + b.subtotal, 0),
        totalAmount: editedItems.reduce((a, b) => a + b.subtotal, 0),
        overrideTxStatus: 'Selesai',
        bypassIdempotency: true,
        overrideQueueNumber: pendingTx.queueNumber,
        // reservedDeductions = deduksi PENDING ORIGINAL (bukan cart baru) — idempoten
        reservedDeductions: calculateItemDeductions(pendingTx.items, useMenuStore.getState().menus),
      })
    );
    expect(r.success).toBe(true);

    // Matematika: gula 10 − (4 reserve) − 2 delta = 4; teh 5 − 2 − 1 = 2; kopi 8 − 1 = 7
    expect(stockOf('gula')).toBe(4);
    expect(stockOf('teh')).toBe(2);
    expect(stockOf('kopi')).toBe(7);

    // Perubahan qty custom (3→5) TIDAK memicu deduksi/revert apa pun
    // (custom tidak punya resep → tidak ikut delta).
    const txs = useTransactionStore.getState().transactions;
    expect(txs).toHaveLength(1);
    expect(txs[0].txStatus).toBe('Selesai');
    expect(txs[0].queueNumber).toBe(pendingTx.queueNumber);

    const customLine = txs[0].items.find((i) => i.isCustom)!;
    expect(customLine.quantity).toBe(5); // edit custom tersimpan di transaksi
    expect(customLine.recipeSnapshot).toEqual([]);
    expect(txs[0].items).toHaveLength(3);
    // HPP transaksi = HPP menu saja (custom 0) — sesudah edit tetap benar
    const m1hpp = txs[0].items.find((i) => i.menuId === 'm1')?.hpp || 0;
    const m2hpp = txs[0].items.find((i) => i.menuId === 'm2')?.hpp || 0;
    expect(txs[0].hpp).toBe(m1hpp + m2hpp);
  });

  it('RESUME + HAPUS ITEM CUSTOM: reversi delta HANYA selisih bahan menu — menghapus custom tidak me-revert apa pun', async () => {
    const esTeh = makeMenu('m1', 'Es Teh', 5000, { gula: 2, teh: 1 });
    const kopi = makeMenu('m2', 'Kopi', 8000, { kopi: 1 });
    useMenuStore.setState({ menus: [esTeh, kopi] });
    useInventoryStore.setState({ items: [makeInv('gula', 10), makeInv('teh', 5), makeInv('kopi', 8)] });

    // PENDING: m1 qty 2 (gula 4 + teh 2) + m2 qty 1 (kopi 1) + custom qty 3
    const pendingTx = await savePendingAndResume('pending-edit-2', [
      makeMenuCartItem(esTeh, 2),
      makeMenuCartItem(kopi, 1),
      makeCustomItem('Sambal', 10000, 3),
    ]);
    expect(stockOf('gula')).toBe(6);
    expect(stockOf('teh')).toBe(3);
    expect(stockOf('kopi')).toBe(7);

    // RESUME + EDIT: qty m1 2→1 (lepas gula 2 + teh 1), custom DIHAPUS dari cart
    const editedItems = [makeMenuCartItem(esTeh, 1)];

    const { tx: restored } = resolveResumeRestore(
      useCartStore.getState().resumeContext,
      editedItems,
      useTransactionStore.getState().transactions
    );
    expect(restored?.id).toBe('pending-edit-2');

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: restored!.id,
        cartItems: editedItems,
        subtotal: editedItems.reduce((a, b) => a + b.subtotal, 0),
        totalAmount: editedItems.reduce((a, b) => a + b.subtotal, 0),
        overrideTxStatus: 'Selesai',
        bypassIdempotency: true,
        overrideQueueNumber: pendingTx.queueNumber,
        reservedDeductions: calculateItemDeductions(pendingTx.items, useMenuStore.getState().menus),
      })
    );
    expect(r.success).toBe(true);

    // Cart baru deduksi {gula:2, teh:1} vs reserved {gula:4, teh:2, kopi:1} →
    // revert gula 2, teh 1, kopi 1. Custom yang dihapus TIDAK menimbulkan revert.
    expect(stockOf('gula')).toBe(8);
    expect(stockOf('teh')).toBe(4);
    expect(stockOf('kopi')).toBe(8);

    const txs = useTransactionStore.getState().transactions;
    expect(txs).toHaveLength(1);
    expect(txs[0].txStatus).toBe('Selesai');
    expect(txs[0].items).toHaveLength(1); // custom hilang dari transaksi final
    expect(txs[0].items.some((i) => i.isCustom)).toBe(false);
    expect(txs[0].items[0].menuId).toBe('m1');
    expect(txs[0].items[0].quantity).toBe(1);
  });
});

// ============================================================
// 3. REFUND — revert hanya bahan menu, guard double-refund tetap berlaku
// ============================================================
describe('P.4 integrasi — refund transaksi berisi item custom', () => {
  /** Mirip executeRefund di Transactions.tsx (alur P0.2/A4). */
  function simulateRefund(tx: Transaction, menuList: Menu[]) {
    const target = canExecuteRefund(
      tx,
      useTransactionStore.getState().transactions,
      () => false,
      false
    );
    if (!target) return null;

    const deductions = calculateItemDeductions(target.items, menuList);
    useInventoryStore.getState().revertStock(deductions, `Refund transaksi #${target.queueNumber}`);

    useTransactionStore.getState().updateTxMeta(target.id, {
      refunded: true,
      refundedAt: new Date().toISOString(),
      refundedAmount: target.totalAmount,
    });
    return target;
  }

  it('refund menu+custom: stok kembali HANYA untuk bahan menu — custom tidak menimbulkan revert', async () => {
    const esTeh = makeMenu('m1', 'Es Teh', 5000, { gula: 2, teh: 1 });
    useMenuStore.setState({ menus: [esTeh] });
    useInventoryStore.setState({ items: [makeInv('gula', 10), makeInv('teh', 5)] });

    const menuItem = makeMenuCartItem(esTeh, 2);
    const sambal = makeCustomItem('Sambal', 10000, 3);

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: 'tx-refund-1',
        cartItems: [menuItem, sambal],
        subtotal: 40000,
        totalAmount: 40000,
        overrideTxStatus: 'Selesai',
      })
    );
    expect(r.success).toBe(true);
    expect(stockOf('gula')).toBe(6);
    expect(stockOf('teh')).toBe(3);

    const target = simulateRefund(r.transaction as Transaction, [esTeh]);
    expect(target).not.toBeNull();

    // Stok kembali penuh & PERSIS untuk bahan menu yang terpotong (custom 0 → tak ada revert salah)
    expect(stockOf('gula')).toBe(10);
    expect(stockOf('teh')).toBe(5);

    const txAfter = useTransactionStore.getState().transactions.find((t) => t.id === 'tx-refund-1')!;
    expect(txAfter.refunded).toBe(true);
    expect(txAfter.refundedAmount).toBe(40000);
  });

  it('refund custom-only: stok tetap 0 pergerakan; guard anti double-refund tetap menolak refund kedua', async () => {
    useInventoryStore.setState({ items: [makeInv('gula', 7)] });

    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: 'tx-refund-2',
        cartItems: [makeCustomItem('Kerupuk', 2000, 10)],
        subtotal: 20000,
        totalAmount: 20000,
        overrideTxStatus: 'Selesai',
      })
    );
    expect(r.success).toBe(true);
    expect(stockOf('gula')).toBe(7);

    const target = simulateRefund(r.transaction as Transaction, []);
    expect(target).not.toBeNull();
    expect(stockOf('gula')).toBe(7); // revert kosong → stok tidak berubah

    // A4: guard double-refund (cek ulang dari STORE) menolak refund kedua
    const secondTry = canExecuteRefund(
      useTransactionStore.getState().transactions.find((t) => t.id === 'tx-refund-2')!,
      useTransactionStore.getState().transactions,
      () => false,
      false
    );
    expect(secondTry).toBeNull();
  });
});