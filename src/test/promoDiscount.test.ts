import { describe, it, expect } from 'vitest';
import {
  calculatePromoDiscount,
  calculateBogoDiscount,
  isPromoApplicable,
  eligibleItemQty,
} from '../utils/promoDiscount';
import type { Promo, CartItem, Menu } from '../types';

function makePromo(over: Partial<Promo>): Promo {
  return {
    id: 'p1',
    name: 'Promo',
    type: 'percentage',
    value: 10,
    scope: 'all',
    isActive: true,
    usageCount: 0,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-12-31T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function makeItem(over: Partial<CartItem>): CartItem {
  return {
    lineId: 'l1',
    menuId: 'm1',
    name: 'Item',
    basePrice: 10000,
    quantity: 1,
    temperature: 'Hangat',
    sugar: 'None',
    addons: [],
    subtotal: 10000,
    ...over,
  };
}

const menus: Menu[] = [
  {
    id: 'm1', name: 'Lele Original', category: 'Makanan', price: 10000, ingredients: {}, availableAddons: [],
  },
  {
    id: 'm2', name: 'Es Kopi', category: 'Minuman', price: 15000, ingredients: {}, availableAddons: [],
  },
];

// ============================================================
// percentage / fixed — perilaku lama tidak berubah
// ============================================================

describe('percentage & fixed (P-A5 — regresi perilaku lama)', () => {
  it('percentage: subtotal * value%', () => {
    const promo = makePromo({ type: 'percentage', value: 10 });
    expect(calculatePromoDiscount(promo, 100000, { cartItems: [], menus })).toBe(10000);
  });

  it('percentage di-cap maxDiscount', () => {
    const promo = makePromo({ type: 'percentage', value: 10, maxDiscount: 5000 });
    expect(calculatePromoDiscount(promo, 100000, { cartItems: [], menus })).toBe(5000);
  });

  it('fixed: nilai tetap', () => {
    const promo = makePromo({ type: 'fixed', value: 20000 });
    expect(calculatePromoDiscount(promo, 100000, { cartItems: [], menus })).toBe(20000);
  });
});

// ============================================================
// isPromoApplicable — gate
// ============================================================

describe('isPromoApplicable (P-A5 — gate kelayakan)', () => {
  it('nonaktif / belum mulai / sudah berakhir / usage habis → tidak berlaku', () => {
    expect(isPromoApplicable(makePromo({ isActive: false }), 100000, { cartItems: [], menus })).toBe(false);
    expect(isPromoApplicable(makePromo({ startDate: '2099-01-01T00:00:00.000Z' }), 100000, { cartItems: [], menus })).toBe(false);
    expect(isPromoApplicable(makePromo({ endDate: '2020-01-01T00:00:00.000Z' }), 100000, { cartItems: [], menus })).toBe(false);
    expect(isPromoApplicable(makePromo({ usageLimit: 5, usageCount: 5 }), 100000, { cartItems: [], menus })).toBe(false);
  });

  it('min belanja tidak terpenuhi → tidak berlaku', () => {
    expect(isPromoApplicable(makePromo({ minPurchase: 50000 }), 30000, { cartItems: [], menus })).toBe(false);
  });

  it('scope loyalty: kunjungan pelanggan kurang → tidak berlaku', () => {
    const promo = makePromo({ scope: 'loyalty', loyaltyMinVisits: 5, type: 'fixed', value: 5000 });
    expect(isPromoApplicable(promo, 100000, { cartItems: [], menus, selectedCustomer: { visitCount: 3 } as any })).toBe(false);
    expect(isPromoApplicable(promo, 100000, { cartItems: [], menus, selectedCustomer: { visitCount: 6 } as any })).toBe(true);
  });

  it('scope menu/category tanpa item cocok → tidak berlaku', () => {
    const promoMenu = makePromo({ scope: 'menu', scopeTarget: 'm2' });
    expect(isPromoApplicable(promoMenu, 100000, { cartItems: [makeItem({ menuId: 'm1' })], menus })).toBe(false);
    const promoCat = makePromo({ scope: 'category', scopeTarget: 'Minuman' });
    expect(isPromoApplicable(promoCat, 100000, { cartItems: [makeItem({ menuId: 'm1' })], menus })).toBe(false);
    expect(isPromoApplicable(promoCat, 100000, { cartItems: [makeItem({ menuId: 'm2' })], menus })).toBe(true);
  });

  it('minQty: total qty target kurang → tidak berlaku', () => {
    const promo = makePromo({ minQty: 3 });
    expect(isPromoApplicable(promo, 100000, { cartItems: [makeItem({ quantity: 2 })], menus })).toBe(false);
    expect(isPromoApplicable(promo, 100000, { cartItems: [makeItem({ quantity: 3 })], menus })).toBe(true);
  });

  it('minQty dihitung per scope (kategori), bukan seluruh keranjang', () => {
    const promo = makePromo({ scope: 'category', scopeTarget: 'Makanan', minQty: 2 });
    const cart = [
      makeItem({ menuId: 'm1', quantity: 1 }), // Makanan
      makeItem({ menuId: 'm2', quantity: 5 }), // Minuman — tidak dihitung
    ];
    expect(isPromoApplicable(promo, 100000, { cartItems: cart, menus })).toBe(false);
    cart[0] = makeItem({ menuId: 'm1', quantity: 2 });
    expect(isPromoApplicable(promo, 100000, { cartItems: cart, menus })).toBe(true);
  });

  it('P-A6: batas per pelanggan — tanpa pelanggan terpilih → tidak berlaku', () => {
    const promo = makePromo({ usageLimitPerCustomer: 1 });
    expect(isPromoApplicable(promo, 100000, { cartItems: [], menus })).toBe(false);
  });

  it('P-A6: batas per pelanggan — pemakaian sudah mencapai batas → tidak berlaku', () => {
    const promo = makePromo({ usageLimitPerCustomer: 1, usageByCustomer: { 'cust-1': 1 } });
    expect(isPromoApplicable(promo, 100000, { cartItems: [], menus, selectedCustomer: { id: 'cust-1' } as any })).toBe(false);
  });

  it('P-A6: batas per pelanggan — belum mencapai batas → berlaku', () => {
    const promo = makePromo({ usageLimitPerCustomer: 2, usageByCustomer: { 'cust-1': 1 } });
    expect(isPromoApplicable(promo, 100000, { cartItems: [], menus, selectedCustomer: { id: 'cust-1' } as any })).toBe(true);
    // pelanggan lain tidak terpengaruh pemakaian cust-1
    expect(isPromoApplicable(promo, 100000, { cartItems: [], menus, selectedCustomer: { id: 'cust-2' } as any })).toBe(true);
  });
});

// ============================================================
// BOGO
// ============================================================

describe('calculateBogoDiscount (P-A5 — beli N gratis M)', () => {
  it('beli 2 gratis 1 (semua menu): 3 item @ 10rb → 1 item termurah gratis (10rb)', () => {
    const promo = makePromo({ type: 'bogo', value: 0, bogoBuyQty: 2, bogoFreeQty: 1 });
    const cart = [makeItem({ lineId: 'a' }), makeItem({ lineId: 'b' }), makeItem({ lineId: 'c' })];
    expect(calculateBogoDiscount(promo, { cartItems: cart, menus })).toBe(10000);
  });

  it('gratis selalu dari item TERMURAH (15rb + 2×10rb → 10rb)', () => {
    const promo = makePromo({ type: 'bogo', value: 0, bogoBuyQty: 2, bogoFreeQty: 1 });
    const cart = [
      makeItem({ lineId: 'a', menuId: 'm2', basePrice: 15000, subtotal: 15000 }),
      makeItem({ lineId: 'b', basePrice: 10000, subtotal: 10000 }),
      makeItem({ lineId: 'c', basePrice: 10000, subtotal: 10000 }),
    ];
    expect(calculateBogoDiscount(promo, { cartItems: cart, menus })).toBe(10000);
  });

  it('qty > 1: 4 unit @ 10rb, beli 2 gratis 1 → 2 set → 2 gratis (20rb)', () => {
    const promo = makePromo({ type: 'bogo', value: 0, bogoBuyQty: 2, bogoFreeQty: 1 });
    const cart = [makeItem({ quantity: 4 })];
    expect(calculateBogoDiscount(promo, { cartItems: cart, menus })).toBe(20000);
  });

  it('belum memenuhi 1 set (1 unit, beli 2) → 0', () => {
    const promo = makePromo({ type: 'bogo', value: 0, bogoBuyQty: 2, bogoFreeQty: 1 });
    expect(calculateBogoDiscount(promo, { cartItems: [makeItem()], menus })).toBe(0);
  });

  it('bogoPercent 50: item gratis hanya diskon 50% (10rb → 5rb)', () => {
    const promo = makePromo({ type: 'bogo', value: 0, bogoBuyQty: 2, bogoFreeQty: 1, bogoPercent: 50 });
    const cart = [makeItem({ lineId: 'a' }), makeItem({ lineId: 'b' }), makeItem({ lineId: 'c' })];
    expect(calculateBogoDiscount(promo, { cartItems: cart, menus })).toBe(5000);
  });

  it('scope menu: hanya item target yang dihitung', () => {
    const promo = makePromo({ type: 'bogo', value: 0, bogoBuyQty: 2, bogoFreeQty: 1, scope: 'menu', scopeTarget: 'm1' });
    const cart = [
      makeItem({ menuId: 'm1', quantity: 3 }), // 3 unit target → 1 gratis
      makeItem({ menuId: 'm2', quantity: 10 }), // bukan target
    ];
    expect(calculateBogoDiscount(promo, { cartItems: cart, menus })).toBe(10000);
  });

  it('scope category: hanya kategori target yang dihitung', () => {
    const promo = makePromo({ type: 'bogo', value: 0, bogoBuyQty: 3, bogoFreeQty: 1, scope: 'category', scopeTarget: 'Makanan' });
    const cart = [
      makeItem({ menuId: 'm1', quantity: 3 }), // Makanan → 1 gratis
      makeItem({ menuId: 'm2', quantity: 5 }), // Minuman — tidak dihitung
    ];
    expect(calculateBogoDiscount(promo, { cartItems: cart, menus })).toBe(10000);
  });

  it('harga satuan termasuk addon', () => {
    const promo = makePromo({ type: 'bogo', value: 0, bogoBuyQty: 2, bogoFreeQty: 1 });
    const cart = [
      makeItem({ lineId: 'a', basePrice: 8000, addons: [{ name: 'Topping', price: 2000 }] }), // 10rb
      makeItem({ lineId: 'b' }),
      makeItem({ lineId: 'c' }),
    ];
    expect(calculateBogoDiscount(promo, { cartItems: cart, menus })).toBe(10000);
  });
});

// ============================================================
// calculatePromoDiscount — jalur lengkap
// ============================================================

describe('calculatePromoDiscount (P-A5 — integrasi gate + BOGO)', () => {
  it('BOGO tidak berlaku bila scope tidak cocok → 0', () => {
    const promo = makePromo({ type: 'bogo', value: 0, bogoBuyQty: 2, bogoFreeQty: 1, scope: 'menu', scopeTarget: 'm2' });
    expect(calculatePromoDiscount(promo, 100000, { cartItems: [makeItem({ menuId: 'm1' })], menus })).toBe(0);
  });

  it('minQty gate bekerja lewat calculatePromoDiscount (diskon %)', () => {
    const promo = makePromo({ type: 'percentage', value: 10, minQty: 3 });
    expect(calculatePromoDiscount(promo, 100000, { cartItems: [makeItem({ quantity: 2 })], menus })).toBe(0);
    expect(calculatePromoDiscount(promo, 100000, { cartItems: [makeItem({ quantity: 3 })], menus })).toBe(10000);
  });

  it('BOGO penuh via calculatePromoDiscount', () => {
    const promo = makePromo({ type: 'bogo', value: 0, bogoBuyQty: 2, bogoFreeQty: 1 });
    const cart = [makeItem({ lineId: 'a' }), makeItem({ lineId: 'b' }), makeItem({ lineId: 'c' })];
    expect(calculatePromoDiscount(promo, 30000, { cartItems: cart, menus })).toBe(10000);
  });

  it('P-A6: batas per pelanggan bekerja lewat calculatePromoDiscount (diskonto 0 bila habis)', () => {
    const promo = makePromo({ type: 'percentage', value: 10, usageLimitPerCustomer: 1, usageByCustomer: { 'cust-1': 1 } });
    expect(calculatePromoDiscount(promo, 100000, { cartItems: [], menus, selectedCustomer: { id: 'cust-1' } as any })).toBe(0);
    expect(calculatePromoDiscount(promo, 100000, { cartItems: [], menus, selectedCustomer: { id: 'cust-2' } as any })).toBe(10000);
  });
});

// ============================================================
// eligibleItemQty — helper qty per scope
// ============================================================

describe('eligibleItemQty (P-A5)', () => {
  it('scope all → semua qty; menu/category → hanya target', () => {
    const cart = [makeItem({ menuId: 'm1', quantity: 2 }), makeItem({ menuId: 'm2', quantity: 3 })];
    expect(eligibleItemQty(makePromo({ scope: 'all' }), { cartItems: cart, menus })).toBe(5);
    expect(eligibleItemQty(makePromo({ scope: 'menu', scopeTarget: 'm1' }), { cartItems: cart, menus })).toBe(2);
    expect(eligibleItemQty(makePromo({ scope: 'category', scopeTarget: 'Minuman' }), { cartItems: cart, menus })).toBe(3);
  });
});
