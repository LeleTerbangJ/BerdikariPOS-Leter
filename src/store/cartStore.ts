import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem } from '../types';

interface CartState {
  items: CartItem[];
  discount: number;
  addItem: (item: CartItem) => void;
  addBundleItem: (parentItem: CartItem, childItems: CartItem[]) => void;
  removeItem: (lineId: string) => void;
  updateQuantity: (lineId: string, qty: number) => void;
  setDiscount: (amount: number) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getTotal: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      discount: 0,

      addItem: (item) => set((s) => {
        const existingIdx = s.items.findIndex((i) => {
          if (i.menuId !== item.menuId) return false;
          if (i.temperature !== item.temperature) return false;
          if (i.sugar !== item.sugar) return false;
          if (i.addons.length !== item.addons.length) return false;
          const names1 = i.addons.map((a) => a.name).sort();
          const names2 = item.addons.map((a) => a.name).sort();
          return names1.every((val, idx) => val === names2[idx]);
        });

        if (existingIdx !== -1) {
          const updated = [...s.items];
          const existing = updated[existingIdx];
          const newQty = existing.quantity + item.quantity;
          const unitPrice = existing.basePrice + existing.addons.reduce((a, b) => a + b.price, 0);
          updated[existingIdx] = {
            ...existing,
            quantity: newQty,
            subtotal: unitPrice * newQty,
          };
          return { items: updated };
        }

        return { items: [...s.items, item] };
      }),

      addBundleItem: (parentItem, childItems) => set((s) => ({
        items: [...s.items, parentItem, ...childItems],
      })),

      removeItem: (lineId) =>
        set((s) => ({
          // Remove target item and any child items linked to it
          items: s.items.filter((i) => i.lineId !== lineId && i.parentLineId !== lineId),
        })),

      updateQuantity: (lineId, qty) =>
        set((s) => {
          const targetItem = s.items.find((i) => i.lineId === lineId);
          if (!targetItem) return { items: s.items };

          const oldQty = targetItem.quantity;
          if (oldQty <= 0) return { items: s.items };

          return {
            items: s.items.map((i) => {
              if (i.lineId === lineId) {
                const unitPrice = i.basePrice + i.addons.reduce((a, b) => a + b.price, 0);
                return { ...i, quantity: qty, subtotal: unitPrice * qty };
              }
              // Scale child items linked to parent bundle
              if (i.parentLineId === lineId) {
                const perBundleQty = Math.max(1, Math.round(i.quantity / oldQty));
                return { ...i, quantity: perBundleQty * qty };
              }
              return i;
            }),
          };
        }),

      setDiscount: (amount) => set({ discount: amount }),

      clearCart: () => set({ items: [], discount: 0 }),

      getSubtotal: () => get().items.reduce((a, b) => a + b.subtotal, 0),

      getTotal: () => {
        const sub = get().items.reduce((a, b) => a + b.subtotal, 0);
        return Math.max(0, sub - get().discount);
      },
    }),
    { name: 'rempah-cart' }
  )
);
