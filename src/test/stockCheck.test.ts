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
});
