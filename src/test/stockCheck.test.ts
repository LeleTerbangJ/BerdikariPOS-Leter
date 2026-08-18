import { describe, it, expect } from 'vitest';
import { checkStockAvailability } from '../utils/stockCheck';
import { InventoryEngine } from '../lib/inventoryEngine';
import type { CartItem, Menu, InventoryItem } from '../types';

const inventory: InventoryItem[] = [
  { id: 'beras', name: 'Beras', stock: 2, unit: 'kg', costPerUnit: 10000 } as InventoryItem,
  { id: 'telur', name: 'Telur', stock: 10, unit: 'butir', costPerUnit: 2000 } as InventoryItem,
];

const menu: Menu = {
  id: 'nasi-goreng',
  name: 'Nasi Goreng',
  price: 15000,
  category: 'Makanan',
  // calculateItemDeductions fallback memakai menu.ingredients (Record<invId, qty per porsi>)
  ingredients: { beras: 0.5, telur: 2 },
} as Menu;

const makeCart = (qty: number): CartItem[] => [
  {
    lineId: 'l1',
    menuId: 'nasi-goreng',
    name: 'Nasi Goreng',
    quantity: qty,
    basePrice: 15000,
    price: 15000,
    subtotal: 15000 * qty,
    addons: [],
  } as CartItem,
];

describe('checkStockAvailability alias (TO DO 2.5 — unifikasi validasi stok)', () => {
  it('hasil identik dengan InventoryEngine.validateStockAvailability (.warnings)', () => {
    const alias = checkStockAvailability(makeCart(3), [menu], inventory);
    const engine = InventoryEngine.validateStockAvailability(makeCart(3), [menu], inventory).warnings;
    expect(alias).toEqual(engine);
  });

  it('mendeteksi stok kurang via alias (5x Nasi Goreng → beras 2.5kg > 2kg)', () => {
    const warnings = checkStockAvailability(makeCart(5), [menu], inventory);
    expect(warnings.length).toBe(1);
    expect(warnings[0].ingredientId).toBe('beras');
    expect(warnings[0].required).toBe(2.5);
    expect(warnings[0].available).toBe(2);
  });

  it('stok cukup → tanpa warning', () => {
    expect(checkStockAvailability(makeCart(3), [menu], inventory)).toEqual([]);
  });

  // v4.7 TO DO 18.8 (A11) — bahan yang direferensikan resep sudah dihapus dari inventory
  it('resep memakai bahan yang sudah DIHAPUS → warning missing (bukan dilewati diam-diam)', () => {
    // menu2 merujuk 'gula' yang tidak ada di inventory
    const menu2: Menu = {
      id: 'es-teh',
      name: 'Es Teh',
      price: 5000,
      category: 'Minuman',
      ingredients: { gula: 0.5 },
    } as Menu;
    const cart: CartItem[] = [
      { lineId: 'l2', menuId: 'es-teh', name: 'Es Teh', quantity: 2, basePrice: 5000, price: 5000, subtotal: 10000, addons: [] } as CartItem,
    ];

    const warnings = checkStockAvailability(cart, [menu2], inventory);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      ingredientId: 'gula',
      ingredientName: 'gula',
      required: 1,
      available: 0,
      missing: true,
    });
    // valid=false → checkout terblokir dengan peringatan (bisa "Lanjutkan Tetap")
    expect(InventoryEngine.validateStockAvailability(cart, [menu2], inventory).valid).toBe(false);
  });

  it('campuran: bahan cukup + bahan hilang → warning missing ikut dilaporkan bersama stok kurang', () => {
    const menu3: Menu = {
      id: 'combo',
      name: 'Combo',
      price: 20000,
      category: 'Makanan',
      ingredients: { beras: 1, telur: 2, saus_hilang: 1 },
    } as Menu;
    const cart: CartItem[] = [
      { lineId: 'l3', menuId: 'combo', name: 'Combo', quantity: 1, basePrice: 20000, price: 20000, subtotal: 20000, addons: [] } as CartItem,
    ];

    const warnings = checkStockAvailability(cart, [menu3], inventory);
    // beras 1kg ≤ 2 ✓ ; telur 2 ≤ 10 ✓ ; saus_hilang → missing
    expect(warnings).toHaveLength(1);
    expect(warnings[0].missing).toBe(true);
    expect(warnings[0].ingredientId).toBe('saus_hilang');
  });
});
