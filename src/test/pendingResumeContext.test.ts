import { describe, it, expect, vi, beforeEach } from 'vitest';

// v4.7 TO DO 17.3 (BUG: duplikat transaksi saat pending diedit & dibayar setelah remount):
// identitas pending (currentPendingTx + checkoutTxId) adalah component state POS yang hilang
// saat POS di-unmount (pindah halaman/refresh), sementara cartStore PERSIST → item hasil
// resume tetap ada. Tanpa fix, finalize memakai UUID baru → transaksi DUPLIKAT (pending lama
// masih Pending + transaksi Selesai baru). Fix: persist `resumeContext` di cartStore +
// restore via `resolveResumeRestore` saat POS di-mount ulang agar finalize memakai ID pending
// yang sama.

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
import { useCartStore } from '../store/cartStore';
import { resolveResumeRestore } from '../utils/pendingResume';

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
  useCartStore.setState({ items: [], discount: 0, resumeContext: null });
});

/** Simulasi: simpan pending lalu resume ke keranjang (mirip handleResumePendingOrder). */
async function savePendingAndResume(pendingTxId: string, items: CartItem[]) {
  await AtomicTransactionEngine.executeCheckout(
    baseParams({
      transactionId: pendingTxId,
      cartItems: items,
      subtotal: items.reduce((a, b) => a + b.subtotal, 0),
      totalAmount: items.reduce((a, b) => a + b.subtotal, 0),
      overrideTxStatus: 'Pending',
      pendingNotes: 'Pesanan Gantung POS',
    })
  );
  const tx = useTransactionStore.getState().transactions.find((t) => t.id === pendingTxId)!;
  // Resume: cartStore diisi item pending + konteks resume disimpan (perilaku POS sesudah fix)
  // — urutan sama dengan handleResumePendingOrder (clear → addItem → setResumeContext)
  tx.items.forEach((item) => useCartStore.getState().addItem(item));
  useCartStore.getState().setResumeContext({
    id: tx.id,
    queueNumber: tx.queueNumber,
    kitchenStatus: tx.kitchenStatus,
  });
  return tx;
}

describe('REPRO: pending diedit & dibayar setelah remount → duplikat transaksi', () => {
  it('BUG (tanpa fix): state hilang → finalize UUID baru → 2 transaksi (pending lama + selesai baru)', async () => {
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    useMenuStore.setState({ menus: [m1] });
    useInventoryStore.setState({ items: [makeInv('inv1', 100)] });
    const itemA = makeCartItem(m1, 2);

    await savePendingAndResume('pending-ctx-1', [itemA]);
    expect(useTransactionStore.getState().transactions).toHaveLength(1);

    // REMOUNT: currentPendingTx/checkoutTxId hilang → checkoutTxId jadi UUID BARU (perilaku lama)
    const lostStateTxId = 'uuid-baru-setelah-remount';
    await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: lostStateTxId,
        cartItems: [itemA],
        subtotal: itemA.subtotal,
        totalAmount: itemA.subtotal,
        overrideTxStatus: 'Selesai',
      })
    );

    const txs = useTransactionStore.getState().transactions;
    expect(txs).toHaveLength(2); // ❌ duplikat: 1 Pending lama + 1 Selesai baru
    expect(txs.some((t) => t.id === 'pending-ctx-1' && (t.txStatus === 'Pending' || t.isPending))).toBe(true);
    expect(txs.some((t) => t.id === lostStateTxId && t.txStatus === 'Selesai')).toBe(true);
  });

  it('FIX: resumeContext di-restore → finalize memakai ID pending yang sama → 1 transaksi', async () => {
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    useMenuStore.setState({ menus: [m1] });
    useInventoryStore.setState({ items: [makeInv('inv1', 100)] });
    const itemA = makeCartItem(m1, 2);

    const tx = await savePendingAndResume('pending-ctx-2', [itemA]);
    expect(useTransactionStore.getState().transactions).toHaveLength(1);

    // REMOUNT: POS di-mount ulang → resolveResumeRestore mengembalikan tx pending yang sah
    const { tx: restored, stale } = resolveResumeRestore(
      useCartStore.getState().resumeContext,
      useCartStore.getState().items,
      useTransactionStore.getState().transactions
    );
    expect(stale).toBe(false);
    expect(restored?.id).toBe('pending-ctx-2');

    // finalize memakai ID hasil restore (bukan UUID baru) → upsert by ID → 1 transaksi
    const r = await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: restored!.id,
        cartItems: [itemA],
        subtotal: itemA.subtotal,
        totalAmount: itemA.subtotal,
        overrideTxStatus: 'Selesai',
        bypassIdempotency: true,
        reservedDeductions: { inv1: 2 },
      })
    );
    expect(r.success).toBe(true);

    const txs = useTransactionStore.getState().transactions;
    expect(txs).toHaveLength(1); // ✅ tidak duplikat
    expect(txs[0].id).toBe('pending-ctx-2');
    expect(txs[0].txStatus).toBe('Selesai');
    expect(txs[0].isPending).toBe(false);
    expect(tx.id).toBe(txs[0].id); // pending yang sama di-update, bukan transaksi baru
  });

  it('FIX + item diedit: pending di-update ke Selesai dengan item hasil edit, tetap 1 transaksi', async () => {
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    const m2 = makeMenu('m2', 'Es Teh', 5000, 'inv2');
    useMenuStore.setState({ menus: [m1, m2] });
    useInventoryStore.setState({ items: [makeInv('inv1', 100), makeInv('inv2', 100)] });
    const itemA = makeCartItem(m1, 2);

    await savePendingAndResume('pending-ctx-3', [itemA]);

    // Edit: tambah menu (item hasil edit = itemA + itemB)
    const itemB = makeCartItem(m2, 1);
    const editedItems = [itemA, itemB];
    const { tx: restored } = resolveResumeRestore(
      useCartStore.getState().resumeContext,
      editedItems,
      useTransactionStore.getState().transactions
    );
    expect(restored?.id).toBe('pending-ctx-3');

    await AtomicTransactionEngine.executeCheckout(
      baseParams({
        transactionId: restored!.id,
        cartItems: editedItems,
        subtotal: itemA.subtotal + itemB.subtotal,
        totalAmount: itemA.subtotal + itemB.subtotal,
        overrideTxStatus: 'Selesai',
        bypassIdempotency: true,
        reservedDeductions: { inv1: 2 },
      })
    );

    const txs = useTransactionStore.getState().transactions;
    expect(txs).toHaveLength(1);
    expect(txs[0].items.map((i) => i.menuId).sort()).toEqual(['m1', 'm2']);
    expect(txs[0].txStatus).toBe('Selesai');
  });
});

describe('resolveResumeRestore — aturan restore', () => {
  const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');

  it('tanpa konteks → jangan restore (bukan stale)', () => {
    expect(resolveResumeRestore(null, [makeCartItem(m1, 1)], [])).toEqual({ tx: null, stale: false });
  });

  it('konteks + tx masih Pending + keranjang berisi → restore tx', () => {
    const tx = { id: 'p1', txStatus: 'Pending', isPending: true } as Transaction;
    const r = resolveResumeRestore({ id: 'p1' }, [makeCartItem(m1, 1)], [tx]);
    expect(r.tx?.id).toBe('p1');
    expect(r.stale).toBe(false);
  });

  it('tx sudah Selesai (dibayar di device lain) → STALE, jangan restore', () => {
    const tx = { id: 'p1', txStatus: 'Selesai', isPending: false } as Transaction;
    const r = resolveResumeRestore({ id: 'p1' }, [makeCartItem(m1, 1)], [tx]);
    expect(r.tx).toBeNull();
    expect(r.stale).toBe(true);
  });

  it('tx tidak ditemukan (dibatalkan/void di device lain) → STALE', () => {
    const r = resolveResumeRestore({ id: 'ghost' }, [makeCartItem(m1, 1)], []);
    expect(r.tx).toBeNull();
    expect(r.stale).toBe(true);
  });

  it('keranjang kosong → jangan restore (bukan stale)', () => {
    const tx = { id: 'p1', txStatus: 'Pending', isPending: true } as Transaction;
    const r = resolveResumeRestore({ id: 'p1' }, [], [tx]);
    expect(r.tx).toBeNull();
    expect(r.stale).toBe(false);
  });
});

describe('cartStore — siklus hidup resumeContext', () => {
  it('setResumeContext menyimpan & clearCart membersihkan', () => {
    useCartStore.getState().setResumeContext({ id: 'p1', queueNumber: 7, kitchenStatus: 'Waiting' });
    expect(useCartStore.getState().resumeContext).toEqual({ id: 'p1', queueNumber: 7, kitchenStatus: 'Waiting' });
    useCartStore.getState().clearCart();
    expect(useCartStore.getState().resumeContext).toBeNull();
  });

  it('hapus item terakhir (keranjang kosong) → resumeContext dibersihkan', () => {
    const m1 = makeMenu('m1', 'Nasi Goreng', 15000, 'inv1');
    const item = makeCartItem(m1, 1);
    useCartStore.getState().addItem(item);
    useCartStore.getState().setResumeContext({ id: 'p1' });
    useCartStore.getState().removeItem(item.lineId);
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useCartStore.getState().resumeContext).toBeNull();
  });

  it('hapus sebagian item (keranjang masih berisi) → resumeContext dipertahankan', () => {
    const m1 = makeMenu('m1', 'A', 15000, 'inv1');
    const m2 = makeMenu('m2', 'B', 5000, 'inv2');
    const i1 = makeCartItem(m1, 1);
    const i2 = makeCartItem(m2, 1);
    useCartStore.getState().addItem(i1);
    useCartStore.getState().addItem(i2);
    useCartStore.getState().setResumeContext({ id: 'p1' });
    useCartStore.getState().removeItem(i1.lineId);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().resumeContext).toEqual({ id: 'p1' });
  });
});
