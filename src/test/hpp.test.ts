import { describe, it, expect } from 'vitest';
import { calculateItemDeductions } from '../utils/hpp';
import type { CartItem, Menu } from '../types';

function makeMenu(id: string, ingredients: Record<string, number> = {}): Menu {
  return {
    id,
    name: id,
    category: 'Makanan',
    price: 10000,
    ingredients,
    availableAddons: [],
  } as Menu;
}

function makeItem(
  menuId: string,
  quantity: number,
  overrides: Partial<CartItem> = {}
): CartItem {
  return {
    lineId: `${menuId}-${quantity}-${Math.random().toString(36).slice(2, 8)}`,
    menuId,
    name: menuId,
    quantity,
    basePrice: 10000,
    price: 10000,
    subtotal: 10000 * quantity,
    addons: [],
    ...overrides,
  } as CartItem;
}

describe('calculateItemDeductions — v4.7 TO DO 18.8 (A2: snapshot/legacy PER ITEM)', () => {
  it('CAMPURAN: item dengan snapshot + item legacy → KEDUANYA dihitung (sebelumnya legacy hilang)', () => {
    const snapshotItem = makeItem('Menu Baru', 2, {
      recipeSnapshot: [{ inventoryId: 'inv-snap', inventoryName: 'Bahan Snapshot', unit: 'pcs', qty: 1, totalQty: 2, unitCost: 1000, subtotalCost: 2000, source: 'menu' }],
    });
    const legacyItem = makeItem('Menu Lama', 3);
    const menus = [makeMenu('Menu Lama', { 'inv-legacy': 1 })];

    const deductions = calculateItemDeductions([snapshotItem, legacyItem], menus);

    // A2: item legacy TIDAK boleh hilang hanya karena ada item lain ber-snapshot
    expect(deductions).toEqual({ 'inv-snap': 2, 'inv-legacy': 3 });
  });

  it('semua item ber-snapshot → snapshot dipakai, manual_ dikecualikan', () => {
    const item = makeItem('Menu Baru', 1, {
      recipeSnapshot: [
        { inventoryId: 'inv-1', inventoryName: 'Bahan 1', unit: 'pcs', qty: 2, totalQty: 2, unitCost: 100, subtotalCost: 200, source: 'menu' },
        { inventoryId: 'manual_Menu Baru', inventoryName: 'HPP Manual', unit: 'pcs', qty: 1, totalQty: 1, unitCost: 5000, subtotalCost: 5000, source: 'menu' },
      ],
    });
    expect(calculateItemDeductions([item], [])).toEqual({ 'inv-1': 2 });
  });

  it('tanpa snapshot sama sekali → fallback menu ingredients (transaksi lama)', () => {
    const item = makeItem('Es Teh', 2);
    const menus = [makeMenu('Es Teh', { 'gula': 3, 'teh': 1 })];
    expect(calculateItemDeductions([item], menus)).toEqual({ gula: 6, teh: 2 });
  });

  it('item dengan recipeSnapshot KOSONG ([]) → diperlakukan legacy (fallback menu)', () => {
    const item = makeItem('Kopi', 1, { recipeSnapshot: [] });
    const menus = [makeMenu('Kopi', { 'kopi-bubuk': 2 })];
    expect(calculateItemDeductions([item], menus)).toEqual({ 'kopi-bubuk': 2 });
  });

  it('fallback addon: addon dengan ingredients langsung / match dari menu', () => {
    const withOwnIngredients = makeItem('Minuman', 1, {
      addons: [{ name: 'Boba', price: 5000, ingredients: { 'boba': 2 } }],
    });
    const menus = [
      makeMenu('Minuman', { 'teh': 1 }),
    ];
    const d1 = calculateItemDeductions([withOwnIngredients], menus);
    expect(d1).toEqual({ teh: 1, boba: 2 });

    // Addon tanpa ingredients → fallback ke availableAddons menu
    const viaMenu = makeItem('Minuman', 2, {
      addons: [{ name: 'Susu', price: 3000 }],
    });
    const menusWithAddon: Menu[] = [{
      id: 'Minuman',
      name: 'Minuman',
      category: 'Minuman',
      price: 10000,
      ingredients: { 'teh': 1 },
      availableAddons: [{ name: 'Susu', price: 3000, ingredients: { 'susu': 1 } }],
    } as Menu];
    expect(calculateItemDeductions([viaMenu], menusWithAddon)).toEqual({ teh: 2, susu: 2 });
  });

  it('gabungan deduksi bahan yang sama dari beberapa item (akumulasi)', () => {
    const a = makeItem('A', 1);
    const b = makeItem('B', 2);
    const menus = [makeMenu('A', { 'gula': 1 }), makeMenu('B', { 'gula': 2 })];
    expect(calculateItemDeductions([a, b], menus)).toEqual({ gula: 5 });
  });
});
