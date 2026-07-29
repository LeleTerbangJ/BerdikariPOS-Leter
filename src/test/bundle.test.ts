import { describe, it, expect } from 'vitest';
import { validateMenuComponent, hasCircularReference } from '../lib/bundleValidation';
import {
  createBundleChildCartItems,
  calculateBundleHPP,
  buildBundleComponentsSnapshot,
  filterItemsForKitchen,
  filterItemsForSalesReport,
} from '../lib/bundleService';
import type { Menu, CartItem, InventoryItem } from '../types';

describe('Bundle System Validation', () => {
  const sampleMenus: Menu[] = [
    {
      id: 'nasi-putih',
      name: 'Nasi Putih',
      category: 'Makanan',
      price: 5000,
      ingredients: { beras: 0.1 },
      availableAddons: [],
      kitchenTarget: 'Dapur',
    },
    {
      id: 'lele-terbang',
      name: 'Lele Terbang',
      category: 'Makanan',
      price: 15000,
      ingredients: { lele: 1, minyak: 0.05 },
      availableAddons: [],
      kitchenTarget: 'Dapur',
    },
    {
      id: 'es-teh',
      name: 'Es Teh',
      category: 'Minuman',
      price: 4000,
      ingredients: { teh: 1, gula: 0.02 },
      availableAddons: [],
      kitchenTarget: 'Bar',
    },
    {
      id: 'paket-lele',
      name: 'Paket Komplit Lele',
      category: 'Paket',
      price: 22000,
      isBundle: true,
      ingredients: {},
      availableAddons: [],
      components: [
        { id: 'c1', parentMenuId: 'paket-lele', childType: 'Menu', childId: 'nasi-putih', quantity: 1, mode: 'Bundle' },
        { id: 'c2', parentMenuId: 'paket-lele', childType: 'Menu', childId: 'lele-terbang', quantity: 1, mode: 'Bundle' },
        { id: 'c3', parentMenuId: 'paket-lele', childType: 'Menu', childId: 'es-teh', quantity: 1, mode: 'Bundle' },
      ],
    },
  ];

  it('prevents self-referencing bundle', () => {
    const result = validateMenuComponent('paket-lele', 'Menu', 'paket-lele', sampleMenus);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Self-reference');
  });

  it('prevents nested bundle in v1', () => {
    const result = validateMenuComponent('new-bundle', 'Menu', 'paket-lele', sampleMenus);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Nested Bundle');
  });

  it('detects circular references', () => {
    const circularMenus: Menu[] = [
      {
        id: 'menu-a',
        name: 'Menu A',
        category: 'Paket',
        price: 10000,
        isBundle: true,
        ingredients: {},
        availableAddons: [],
        components: [
          { id: 'ca', parentMenuId: 'menu-a', childType: 'Menu', childId: 'menu-b', quantity: 1, mode: 'Bundle' },
        ],
      },
      {
        id: 'menu-b',
        name: 'Menu B',
        category: 'Paket',
        price: 10000,
        isBundle: true,
        ingredients: {},
        availableAddons: [],
        components: [
          { id: 'cb', parentMenuId: 'menu-b', childType: 'Menu', childId: 'menu-a', quantity: 1, mode: 'Bundle' },
        ],
      },
    ];

    const isCircular = hasCircularReference('menu-a', 'menu-b', circularMenus);
    expect(isCircular).toBe(true);
  });

  it('allows valid menu component addition', () => {
    const result = validateMenuComponent('paket-lele', 'Menu', 'nasi-putih', sampleMenus, []);
    expect(result.valid).toBe(true);
  });
});

describe('Bundle Cart Item Generation & Calculations', () => {
  const inventory: InventoryItem[] = [
    { id: 'beras', name: 'Beras', stock: 100, unit: 'kg', costPerUnit: 12000 },
    { id: 'lele', name: 'Lele', stock: 50, unit: 'ekor', costPerUnit: 6000 },
    { id: 'teh', name: 'Teh Celup', stock: 200, unit: 'pcs', costPerUnit: 500 },
  ];

  const sampleMenus: Menu[] = [
    { id: 'nasi-putih', name: 'Nasi Putih', category: 'Makanan', price: 5000, ingredients: { beras: 0.1 }, availableAddons: [], kitchenTarget: 'Dapur' },
    { id: 'lele-terbang', name: 'Lele Terbang', category: 'Makanan', price: 15000, ingredients: { lele: 1 }, availableAddons: [], kitchenTarget: 'Dapur' },
    { id: 'es-teh', name: 'Es Teh', category: 'Minuman', price: 4000, ingredients: { teh: 1 }, availableAddons: [], kitchenTarget: 'Bar' },
    {
      id: 'paket-lele',
      name: 'Paket Komplit Lele',
      category: 'Paket',
      price: 22000,
      isBundle: true,
      ingredients: {},
      availableAddons: [],
      components: [
        { id: 'c1', parentMenuId: 'paket-lele', childType: 'Menu', childId: 'nasi-putih', quantity: 1, mode: 'Bundle' },
        { id: 'c2', parentMenuId: 'paket-lele', childType: 'Menu', childId: 'lele-terbang', quantity: 1, mode: 'Bundle' },
        { id: 'c3', parentMenuId: 'paket-lele', childType: 'Menu', childId: 'es-teh', quantity: 1, mode: 'Bundle' },
      ],
    },
  ];

  it('generates child cart items with zero price and linked parentLineId', () => {
    const parentCartItem: CartItem = {
      lineId: 'line-parent-1',
      menuId: 'paket-lele',
      name: 'Paket Komplit Lele',
      basePrice: 22000,
      quantity: 2,
      temperature: 'Dingin',
      sugar: 'Normal',
      addons: [],
      subtotal: 44000,
      isBundle: true,
    };

    const bundleMenu = sampleMenus.find((m) => m.id === 'paket-lele')!;
    const children = createBundleChildCartItems(parentCartItem, bundleMenu, sampleMenus, inventory);

    expect(children.length).toBe(3);

    // Verify 2x multiplier
    const nasiChild = children.find((c) => c.menuId === 'nasi-putih');
    expect(nasiChild).toBeDefined();
    expect(nasiChild?.quantity).toBe(2);
    expect(nasiChild?.basePrice).toBe(0);
    expect(nasiChild?.subtotal).toBe(0);
    expect(nasiChild?.isBundleChild).toBe(true);
    expect(nasiChild?.parentLineId).toBe('line-parent-1');
    expect(nasiChild?.kitchenTarget).toBe('Dapur');

    const tehChild = children.find((c) => c.menuId === 'es-teh');
    expect(tehChild?.kitchenTarget).toBe('Bar');
  });

  it('calculates bundle HPP correctly by summing child menu HPPs', () => {
    const bundleMenu = sampleMenus.find((m) => m.id === 'paket-lele')!;
    // Nasi HPP: 0.1 * 12000 = 1200
    // Lele HPP: 1 * 6000 = 6000
    // Teh HPP: 1 * 500 = 500
    // Total Bundle HPP = 1200 + 6000 + 500 = 7700
    const totalHpp = calculateBundleHPP(bundleMenu, sampleMenus, inventory);
    expect(totalHpp).toBe(7700);
  });

  it('correctly filters items for Kitchen Ticket vs Sales Reports', () => {
    const cartItems: CartItem[] = [
      {
        lineId: 'parent-1',
        menuId: 'paket-lele',
        name: 'Paket Komplit Lele',
        basePrice: 22000,
        quantity: 1,
        temperature: 'Dingin',
        sugar: 'Normal',
        addons: [],
        subtotal: 22000,
        isBundle: true,
      },
      {
        lineId: 'child-1',
        menuId: 'lele-terbang',
        name: 'Lele Terbang',
        basePrice: 0,
        quantity: 1,
        temperature: 'Hangat',
        sugar: 'None',
        addons: [],
        subtotal: 0,
        isBundleChild: true,
        parentLineId: 'parent-1',
        kitchenTarget: 'Dapur',
      },
      {
        lineId: 'child-2',
        menuId: 'es-teh',
        name: 'Es Teh',
        basePrice: 0,
        quantity: 1,
        temperature: 'Dingin',
        sugar: 'Normal',
        addons: [],
        subtotal: 0,
        isBundleChild: true,
        parentLineId: 'parent-1',
        kitchenTarget: 'Bar',
      },
    ];

    // Kitchen filtering: Bundle Parent is NEVER included
    const kitchenItems = filterItemsForKitchen(cartItems);
    expect(kitchenItems.length).toBe(2);
    expect(kitchenItems.every((i) => !i.isBundle)).toBe(true);

    // Sales report filtering: Child items are NEVER included
    const salesItems = filterItemsForSalesReport(cartItems);
    expect(salesItems.length).toBe(1);
    expect(salesItems[0].menuId).toBe('paket-lele');
  });
});
