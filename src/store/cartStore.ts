import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import type { CartItem } from '../types';

// v4.7 TO DO 17.3: identitas pending yang di-resume — PERSIST (ikut cart tersimpan) agar
// saat POS di-mount ulang (pindah halaman / refresh) finalize tetap memakai ID pending yang
// sama (bukan UUID baru → transaksi duplikat: pending lama + selesai baru).
export interface ResumeContext {
  id: string;
  queueNumber?: number;
  kitchenStatus?: string;
}

interface CartState {
  items: CartItem[];
  discount: number;
  resumeContext: ResumeContext | null;
  activeBatch: number; // 🏷️ v4.9: Kloter aktif (1 = Awal, 2+ = Tambahan)
  setActiveBatch: (batch: number) => void;
  addItem: (item: CartItem) => void;
  addBundleItem: (parentItem: CartItem, childItems: CartItem[]) => void;
  removeItem: (lineId: string) => void;
  updateQuantity: (lineId: string, qty: number) => void;
  // v4.7 TO DO 22.2: set diskon per item (Rp)
  setItemDiscount: (lineId: string, discount: number) => void;
  setDiscount: (amount: number) => void;
  setResumeContext: (ctx: ResumeContext | null) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getTotal: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      discount: 0,
      resumeContext: null,
      activeBatch: 1,

      setActiveBatch: (batch: number) => set({ activeBatch: Math.max(1, batch) }),

      addItem: (item) => set((s) => {
        const itemBatch = item.batch || s.activeBatch || 1;
        const normalizedItem: CartItem = {
          ...item,
          batch: itemBatch,
          batchCreatedAt: item.batchCreatedAt || new Date().toISOString(),
          kitchenItemStatus: item.kitchenItemStatus || 'new',
        };

        // 🏷️ v4.9: Match HANYA dalam batch yang sama agar item Batch 1 (sudah selesai) tidak
        // tergabung dengan item Batch 2 (tambahan baru)
        const existingIdx = s.items.findIndex((i) => {
          if ((i.batch || 1) !== itemBatch) return false;
          if (i.menuId !== normalizedItem.menuId) return false;
          if (i.temperature !== normalizedItem.temperature) return false;
          if (i.sugar !== normalizedItem.sugar) return false;
          if (i.addons.length !== normalizedItem.addons.length) return false;
          const names1 = i.addons.map((a) => a.name).sort();
          const names2 = normalizedItem.addons.map((a) => a.name).sort();
          return names1.every((val, idx) => val === names2[idx]);
        });

        if (existingIdx !== -1) {
          const updated = [...s.items];
          const existing = updated[existingIdx];
          const newQty = existing.quantity + normalizedItem.quantity;
          const unitPrice = existing.basePrice + existing.addons.reduce((a, b) => a + b.price, 0);
          const disc = existing.itemDiscount || 0;
          updated[existingIdx] = {
            ...existing,
            quantity: newQty,
            subtotal: Math.max(0, unitPrice * newQty - disc),
          };
          return { items: updated };
        }

        return { items: [...s.items, normalizedItem] };
      }),

      addBundleItem: (parentItem, childItems) => set((s) => ({
        items: [...s.items, parentItem, ...childItems],
      })),

      removeItem: (lineId) =>
        set((s) => {
          const items = s.items.filter((i) => i.lineId !== lineId && i.parentLineId !== lineId);
          return {
            items,
            // v4.7 TO DO 17.3: keranjang kosong = resume pending dibatalkan (semua item dihapus)
            // → bersihkan konteks resume agar order baru nanti tidak salah me-restore pending lama.
            resumeContext: items.length === 0 ? null : s.resumeContext,
          };
        }),

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
                const disc = i.itemDiscount || 0;
                return { ...i, quantity: qty, subtotal: Math.max(0, unitPrice * qty - disc) };
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

      // v4.7 TO DO 22.2: set diskon per item (Rp) — update subtotal otomatis
      setItemDiscount: (lineId, discount) =>
        set((s) => ({
          items: s.items.map((i) => {
            if (i.lineId !== lineId) return i;
            const unitPrice = i.basePrice + i.addons.reduce((a, b) => a + b.price, 0);
            const safeDisc = Math.max(0, Math.floor(discount || 0));
            return { ...i, itemDiscount: safeDisc, subtotal: Math.max(0, unitPrice * i.quantity - safeDisc) };
          }),
        })),

      setDiscount: (amount) => set({ discount: amount }),

      // v4.7 TO DO 17.3: setter konteks resume pending (dipanggil handleResumePendingOrder POS)
      setResumeContext: (ctx) => set({ resumeContext: ctx }),

      clearCart: () => set({ items: [], discount: 0, resumeContext: null, activeBatch: 1 }),

      getSubtotal: () => get().items.reduce((a, b) => a + b.subtotal, 0),

      getTotal: () => {
        const sub = get().items.reduce((a, b) => a + b.subtotal, 0);
        return Math.max(0, sub - get().discount);
      },
    }),
    { name: 'rempah-cart', storage: createJSONStorage(() => safeStorage) }
  )
);
