import { describe, it, expect } from 'vitest';
import type { CartItem } from '../types';
import { hasNewKitchenItems, calculateDeltaKitchenItems } from '../utils/kitchenTicket';

describe('Kitchen Ticket Delta Utilities (v4.8)', () => {
  const itemA: CartItem = {
    lineId: 'line-1',
    menuId: 'menu-1',
    name: 'Pecel Lele',
    basePrice: 15000,
    subtotal: 30000,
    quantity: 2,
    addons: [],
    temperature: 'Hangat',
    sugar: 'Normal',
  };

  const itemB: CartItem = {
    lineId: 'line-2',
    menuId: 'menu-2',
    name: 'Es Teh',
    basePrice: 5000,
    subtotal: 7000,
    quantity: 1,
    addons: [{ name: 'Susu', price: 2000 }],
    temperature: 'Dingin',
    sugar: 'Less',
  };

  describe('hasNewKitchenItems', () => {
    it('mengembalikan false jika item keranjang sama persis dengan pending', () => {
      const cart = [itemA, itemB];
      const pending = [itemA, itemB];
      expect(hasNewKitchenItems(cart, pending)).toBe(false);
    });

    it('mengembalikan false jika item dikurangi atau dihapus', () => {
      // Hapus itemB, kurangi porsi itemA
      const cart = [{ ...itemA, quantity: 1, subtotal: 15000 }];
      const pending = [itemA, itemB];
      expect(hasNewKitchenItems(cart, pending)).toBe(false);
    });

    it('mengembalikan true jika ada item baru ditambahkan', () => {
      const itemC: CartItem = {
        lineId: 'line-3',
        menuId: 'menu-3',
        name: 'Ayam Goreng',
        basePrice: 18000,
        subtotal: 18000,
        quantity: 1,
        addons: [],
        temperature: 'Hangat',
        sugar: 'Normal',
      };
      const cart = [itemA, itemB, itemC];
      const pending = [itemA, itemB];
      expect(hasNewKitchenItems(cart, pending)).toBe(true);
    });

    it('mengembalikan true jika kuantitas item yang ada bertambah', () => {
      const cart = [{ ...itemA, quantity: 3, subtotal: 45000 }, itemB];
      const pending = [itemA, itemB];
      expect(hasNewKitchenItems(cart, pending)).toBe(true);
    });

    it('mengembalikan true jika spesifikasi item berubah (suhu/gula/addons)', () => {
      const cart = [itemA, { ...itemB, temperature: 'Hangat' as any }];
      const pending = [itemA, itemB];
      expect(hasNewKitchenItems(cart, pending)).toBe(true);
    });
  });

  describe('calculateDeltaKitchenItems', () => {
    it('menghasilkan delta kosong jika item dikurangi atau sama', () => {
      const cart = [{ ...itemA, quantity: 1, subtotal: 15000 }];
      const pending = [itemA, itemB];
      const res = calculateDeltaKitchenItems(cart, pending);
      expect(res).toHaveLength(0);
    });

    it('menghasilkan delta item baru dengan kuantitas penuh', () => {
      const itemC: CartItem = {
        lineId: 'line-3',
        menuId: 'menu-3',
        name: 'Ayam Goreng',
        basePrice: 18000,
        subtotal: 36000,
        quantity: 2,
        addons: [],
        temperature: 'Hangat',
        sugar: 'Normal',
      };
      const cart = [itemA, itemB, itemC];
      const pending = [itemA, itemB];
      const res = calculateDeltaKitchenItems(cart, pending);
      expect(res).toHaveLength(1);
      expect(res[0].lineId).toBe('line-3');
      expect(res[0].quantity).toBe(2);
    });

    it('menghasilkan delta kuantitas selisih jika kuantitas bertambah', () => {
      const cart = [{ ...itemA, quantity: 5, subtotal: 75000 }, itemB];
      const pending = [itemA, itemB];
      const res = calculateDeltaKitchenItems(cart, pending);
      expect(res).toHaveLength(1);
      expect(res[0].lineId).toBe('line-1');
      expect(res[0].quantity).toBe(3); // 5 - 2 = 3
    });

    it('menghasilkan delta item penuh jika spesifikasi item berubah', () => {
      const cart = [itemA, { ...itemB, temperature: 'Hangat' as any, quantity: 2, subtotal: 14000 }];
      const pending = [itemA, itemB];
      const res = calculateDeltaKitchenItems(cart, pending);
      expect(res).toHaveLength(1);
      expect(res[0].lineId).toBe('line-2');
      expect(res[0].quantity).toBe(2); // Kuantitas penuh dari item berspesifikasi baru
      expect(res[0].temperature).toBe('Hangat');
    });
  });
});
