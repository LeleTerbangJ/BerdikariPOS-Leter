// ============================================================
// v4.7 TO DO 22.2: Diskon Per Menu di POS — Test
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from '../store/cartStore';
import type { CartItem } from '../types';

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    lineId: 'line-1',
    menuId: 'menu-1',
    name: 'Es Teh',
    basePrice: 8000,
    quantity: 2,
    temperature: 'Dingin',
    sugar: 'Normal',
    addons: [],
    subtotal: 16000,
    ...overrides,
  };
}

function makeSecondItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    lineId: 'line-2',
    menuId: 'menu-2',
    name: 'Kopi',
    basePrice: 15000,
    quantity: 1,
    temperature: 'Dingin',
    sugar: 'Normal',
    addons: [],
    subtotal: 15000,
    ...overrides,
  };
}

describe('itemDiscount', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart();
  });

  describe('CartItem type', () => {
    it('itemDiscount defaults to undefined (no discount)', () => {
      const item = makeItem();
      expect(item.itemDiscount).toBeUndefined();
    });

    it('itemDiscount can be set', () => {
      const item = makeItem({ itemDiscount: 2000 });
      expect(item.itemDiscount).toBe(2000);
    });
  });

  describe('cartStore.setItemDiscount', () => {
    it('sets discount on an item and updates subtotal', () => {
      const cart = useCartStore.getState();
      cart.addItem(makeItem({ lineId: 'line-1', quantity: 2, basePrice: 8000 }));

      expect(useCartStore.getState().items[0].subtotal).toBe(16000);

      cart.setItemDiscount('line-1', 2000);

      const updated = useCartStore.getState().items[0];
      expect(updated.itemDiscount).toBe(2000);
      expect(updated.subtotal).toBe(14000);
    });

    it('clamps negative discount to 0', () => {
      const cart = useCartStore.getState();
      cart.addItem(makeItem({ lineId: 'line-1', quantity: 1, basePrice: 10000 }));

      cart.setItemDiscount('line-1', -5000);

      const updated = useCartStore.getState().items[0];
      expect(updated.itemDiscount).toBe(0);
      expect(updated.subtotal).toBe(10000);
    });

    it('clamps subtotal to 0 when discount > total', () => {
      const cart = useCartStore.getState();
      cart.addItem(makeItem({ lineId: 'line-1', quantity: 1, basePrice: 5000 }));

      cart.setItemDiscount('line-1', 10000);

      const updated = useCartStore.getState().items[0];
      expect(updated.subtotal).toBe(0);
    });

    it('clears discount when set to 0', () => {
      const cart = useCartStore.getState();
      cart.addItem(makeItem({ lineId: 'line-1', quantity: 1, basePrice: 10000 }));
      cart.setItemDiscount('line-1', 3000);

      expect(useCartStore.getState().items[0].itemDiscount).toBe(3000);

      cart.setItemDiscount('line-1', 0);

      const updated = useCartStore.getState().items[0];
      expect(updated.itemDiscount).toBe(0);
      expect(updated.subtotal).toBe(10000);
    });

    it('does not affect other items', () => {
      const cart = useCartStore.getState();
      cart.addItem(makeItem({ lineId: 'line-1', quantity: 1, basePrice: 10000 }));
      cart.addItem(makeSecondItem());

      cart.setItemDiscount('line-1', 5000);

      expect(useCartStore.getState().items[0].subtotal).toBe(5000);
      expect(useCartStore.getState().items[1].subtotal).toBe(15000);
    });
  });

  describe('subtotal with addons + itemDiscount', () => {
    it('calculates correctly with addons and discount', () => {
      const cart = useCartStore.getState();
      cart.addItem(makeItem({
        lineId: 'line-1',
        quantity: 1,
        basePrice: 10000,
        addons: [{ name: 'Extra Shot', price: 3000 }],
        subtotal: 13000,
      }));

      expect(useCartStore.getState().items[0].subtotal).toBe(13000);

      cart.setItemDiscount('line-1', 5000);

      expect(useCartStore.getState().items[0].subtotal).toBe(8000);
    });
  });

  describe('updateQuantity with itemDiscount', () => {
    it('recalculates subtotal when quantity changes', () => {
      const cart = useCartStore.getState();
      cart.addItem(makeItem({ lineId: 'line-1', quantity: 1, basePrice: 10000 }));
      cart.setItemDiscount('line-1', 2000);

      expect(useCartStore.getState().items[0].subtotal).toBe(8000);

      cart.updateQuantity('line-1', 3);

      expect(useCartStore.getState().items[0].subtotal).toBe(28000);
    });
  });

  describe('getSubtotal with itemDiscount', () => {
    it('sums discounted subtotals correctly', () => {
      const cart = useCartStore.getState();
      cart.addItem(makeItem({ lineId: 'line-1', quantity: 2, basePrice: 8000 }));
      cart.addItem(makeSecondItem());

      cart.setItemDiscount('line-1', 3000);

      // line-1: 8000 * 2 - 3000 = 13000
      // line-2: 15000 * 1 = 15000
      // Total: 28000
      expect(useCartStore.getState().getSubtotal()).toBe(28000);
    });
  });

  describe('addItem merge with itemDiscount', () => {
    it('preserves existing itemDiscount when merging same item', () => {
      const cart = useCartStore.getState();
      cart.addItem(makeItem({ lineId: 'line-1', quantity: 1, basePrice: 10000 }));
      cart.setItemDiscount('line-1', 2000);

      // Add same item again (merge quantity) — same menuId triggers merge
      cart.addItem(makeItem({ lineId: 'line-2', quantity: 1, basePrice: 10000 }));

      expect(useCartStore.getState().items).toHaveLength(1);
      const merged = useCartStore.getState().items[0];
      expect(merged.quantity).toBe(2);
      expect(merged.itemDiscount).toBe(2000);
      expect(merged.subtotal).toBe(18000);
    });
  });
});
