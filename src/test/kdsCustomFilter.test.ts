// ============================================================
// v4.10 R-A3 — Sembunyikan item non-menu TANPA target dapur dari KDS
// Test:
//  1. Helper shouldShowInKitchen (unit).
//  2. updateItemKitchenStatus store nyata — status efektif transaksi
//     tidak boleh macet 'Waiting' karena item custom tersembunyi.
//  3. Mirror filter kolom KDS (meniru logika Kitchen.tsx).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cloudSync agar test store tidak menyentuh network (fire-and-forget sync dari store).
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
  syncInventoryStock: vi.fn(),
  adjustInventoryStockCloud: vi.fn().mockResolvedValue({ ok: [], conflicts: [], degraded: false }),
  fetchMaxQueueNumberCloud: vi.fn().mockResolvedValue(0),
  allocateQueueNumberCloud: vi.fn().mockResolvedValue(null),
  deleteInventoryCloud: vi.fn(),
  fetchInventoryFromCloud: vi.fn().mockResolvedValue([]),
  syncStockLog: vi.fn(),
  syncStockLogsBulk: vi.fn(),
  syncAuditLog: vi.fn(),
  fetchAuditLogsFromCloud: vi.fn().mockResolvedValue([]),
  syncTransactionKitchenStatus: vi.fn(),
}));

import type { Transaction, CartItem, KitchenStatus } from '../types';
import { useTransactionStore } from '../store/transactionStore';
import { useMenuStore } from '../store/menuStore';
import { useInventoryStore } from '../store/inventoryStore';
import { shouldShowInKitchen, CUSTOM_MENU_ID_PREFIX } from '../utils/customItem';

function makeItem(menuId: string, qty: number, overrides: Partial<CartItem> = {}): CartItem {
  return {
    lineId: `line-${menuId}-${qty}-${Math.random().toString(36).slice(2, 6)}`,
    menuId,
    name: `Item ${menuId}`,
    basePrice: 10000,
    price: 10000,
    quantity: qty,
    temperature: 'Normal',
    sugar: 'Normal',
    addons: [],
    subtotal: 10000 * qty,
    ...overrides,
  } as CartItem;
}

function makeTran(
  id: string,
  items: CartItem[],
  kitchenStatus: KitchenStatus = 'Waiting',
  txStatus: 'Selesai' | 'Pending' = 'Selesai'
): Transaction {
  return {
    id,
    queueNumber: 1,
    date: new Date().toISOString(),
    items,
    subtotal: items.reduce((a, i) => a + i.subtotal, 0),
    discount: 0,
    totalAmount: items.reduce((a, i) => a + i.subtotal, 0),
    paymentMethod: 'Cash',
    kitchenStatus,
    txStatus,
    cashierId: 'u1',
    cashierName: 'Kasir',
  } as Transaction;
}

const customNoTarget = () => makeItem(`${CUSTOM_MENU_ID_PREFIX}abc`, 2, { isCustom: true, name: 'Sambal' });
const customWithTarget = () => makeItem(`${CUSTOM_MENU_ID_PREFIX}def`, 1, { isCustom: true, kitchenTarget: 'ALL' });
const menuEsTeh = () => makeItem('m1', 1, { name: 'Es Teh', kitchenItemStatus: 'new' as const });

beforeEach(() => {
  vi.clearAllMocks();
  useMenuStore.setState({ menus: [] });
  useInventoryStore.setState({ items: [] });
  useTransactionStore.setState({ transactions: [] });
});

// ============================================================
// 1. Helper shouldShowInKitchen
// ============================================================
describe('shouldShowInKitchen (R-A3)', () => {
  it('menu biasa → tampil di KDS', () => {
    expect(shouldShowInKitchen(menuEsTeh())).toBe(true);
    expect(shouldShowInKitchen(makeItem('m2', 1))).toBe(true);
  });

  it('item non-menu TANPA target dapur → disembunyikan', () => {
    expect(shouldShowInKitchen(customNoTarget())).toBe(false);
  });

  it('item non-menu dengan kitchenTarget string kosong / spasi → disembunyikan', () => {
    expect(shouldShowInKitchen(makeItem(`${CUSTOM_MENU_ID_PREFIX}x`, 1, { isCustom: true, kitchenTarget: '' }))).toBe(false);
    expect(shouldShowInKitchen(makeItem(`${CUSTOM_MENU_ID_PREFIX}x`, 1, { isCustom: true, kitchenTarget: '   ' }))).toBe(false);
  });

  it('item non-menu dengan target dapur eksplisit → tampil (kasir sengaja kirim ke dapur)', () => {
    expect(shouldShowInKitchen(customWithTarget())).toBe(true);
    expect(shouldShowInKitchen(makeItem(`${CUSTOM_MENU_ID_PREFIX}y`, 1, { isCustom: true, kitchenTarget: 'Dapur Utama' }))).toBe(true);
  });

  it('fallback prefix custom: tanpa flag isCustom tetap dihormati', () => {
    // Row lama / lintas device tanpa flag — tapi ditambah target → tampil
    expect(shouldShowInKitchen(makeItem(`${CUSTOM_MENU_ID_PREFIX}z`, 1, { kitchenTarget: 'ALL' }))).toBe(true);
    expect(shouldShowInKitchen(makeItem(`${CUSTOM_MENU_ID_PREFIX}z`, 1))).toBe(false);
  });

  it('null/undefined → false', () => {
    expect(shouldShowInKitchen(null)).toBe(false);
    expect(shouldShowInKitchen(undefined)).toBe(false);
  });
});

// ============================================================
// 2. updateItemKitchenStatus — status efektif tidak macet
// ============================================================
describe('updateItemKitchenStatus dengan item custom tersembunyi (R-A3)', () => {
  it('campuran menu+custom-hidden: menu selesai → transaksi Done (sebelumnya macet Waiting)', () => {
    const menu = menuEsTeh();
    const custom = customNoTarget(); // tanpa status, tanpa target → tidak boleh menahan status
    const tx = makeTran('tx1', [menu, custom]);
    useTransactionStore.setState({ transactions: [tx] });

    useTransactionStore.getState().updateItemKitchenStatus('tx1', menu.lineId, 'done');

    const stored = useTransactionStore.getState().transactions.find((t) => t.id === 'tx1')!;
    expect(stored.kitchenStatus).toBe('Done');
    // Item custom tersembunyi tidak tersentuh (tetap tanpa kitchenItemStatus)
    expect(stored.items.find((i) => i.lineId === custom.lineId)?.kitchenItemStatus).toBeUndefined();
  });

  it('campuran: menu diproses → Processing (bukan Waiting karena custom)', () => {
    const menu = menuEsTeh();
    const tx = makeTran('tx2', [menu, customNoTarget()]);
    useTransactionStore.setState({ transactions: [tx] });

    useTransactionStore.getState().updateItemKitchenStatus('tx2', menu.lineId, 'processing');

    const stored = useTransactionStore.getState().transactions.find((t) => t.id === 'tx2')!;
    expect(stored.kitchenStatus).toBe('Processing');
  });

  it('item non-menu BERTARGET tetap diperhitungkan seperti item menu', () => {
    const custom = customWithTarget();
    const tx = makeTran('tx3', [custom]);
    useTransactionStore.setState({ transactions: [tx] });

    // Status baru (belum diproses) → Waiting
    expect(useTransactionStore.getState().transactions.find((t) => t.id === 'tx3')?.kitchenStatus).toBe('Waiting');

    useTransactionStore.getState().updateItemKitchenStatus('tx3', custom.lineId, 'done');
    expect(useTransactionStore.getState().transactions.find((t) => t.id === 'tx3')?.kitchenStatus).toBe('Done');
  });

  it('transaksi hanya berisi custom tersembunyi → tidak pernah menahan status Waiting', () => {
    const custom = customNoTarget();
    const tx = makeTran('tx4', [custom]);
    useTransactionStore.setState({ transactions: [tx] });

    // Update apa pun (atau tanpa update) → tidak ada item visible → status tidak terikat di Waiting
    useTransactionStore.getState().updateItemKitchenStatus('tx4', custom.lineId, 'done');
    expect(useTransactionStore.getState().transactions.find((t) => t.id === 'tx4')?.kitchenStatus).toBe('Done');
  });
});

// ============================================================
// 3. Mirror filter kolom KDS (logika Kitchen.tsx, per kolom)
// ============================================================
describe('mirror filter kolom KDS (R-A3)', () => {
  // Replikasi logika filter kolom di Kitchen.tsx (v4.8.4 + R-A3)
  const inColumn = (t: Transaction, status: 'Waiting' | 'Processing' | 'Done'): boolean => {
    const visible = t.items.filter((i) => !i.isBundle && shouldShowInKitchen(i));
    if (visible.length === 0) return false; // R-A3: tidak ada item layak tampil → tidak masuk kolom mana pun
    const hasKitchenItemStatus = visible.some((i) => i.kitchenItemStatus);
    if (!hasKitchenItemStatus) return t.kitchenStatus === status;
    if (status === 'Waiting') return visible.some((i) => (i.kitchenItemStatus || 'new') === 'new');
    if (status === 'Processing') return visible.some((i) => i.kitchenItemStatus === 'processing');
    if (status === 'Done') return visible.some((i) => i.kitchenItemStatus === 'done');
    return false;
  };

  it('transaksi custom-hidden saja TIDAK muncul di kolom mana pun (walau kitchenStatus Waiting)', () => {
    const tx = makeTran('kds1', [customNoTarget()], 'Waiting');
    expect(inColumn(tx, 'Waiting')).toBe(false);
    expect(inColumn(tx, 'Processing')).toBe(false);
    expect(inColumn(tx, 'Done')).toBe(false);
  });

  it('campuran: item custom-hidden tidak menahan transaksi di kolom Waiting saat menu selesai', () => {
    const menu = menuEsTeh(); // 'new'
    let tx = makeTran('kds2', [menu, customNoTarget()], 'Waiting');
    expect(inColumn(tx, 'Waiting')).toBe(true);

    // Menu ditandai done → kolom Waiting kosong, kolom Done terisi (custom-hidden ignorable)
    tx = makeTran('kds2', [{ ...menu, kitchenItemStatus: 'done' as const }, customNoTarget()], 'Waiting');
    expect(inColumn(tx, 'Waiting')).toBe(false);
    expect(inColumn(tx, 'Done')).toBe(true);
  });

  it('item custom BERTARGET ikut menentukan kolom seperti item menu', () => {
    const custom = customWithTarget(); // 'new'
    const tx = makeTran('kds3', [custom], 'Waiting');
    expect(inColumn(tx, 'Waiting')).toBe(true);
    const doneTx = makeTran('kds3', [{ ...custom, kitchenItemStatus: 'done' as const }], 'Waiting');
    expect(inColumn(doneTx, 'Waiting')).toBe(false);
    expect(inColumn(doneTx, 'Done')).toBe(true);
  });
});