import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import type { Customer } from '../types';
import { syncCustomer, deleteCustomerCloud, fetchCustomersFromCloud } from '../lib/cloudSync';
// v4.7 TO DO 12.2.2 (P-A8): poin loyalty — earn di recordVisit, clawback di revertVisit
import { usePromoStore } from './promoStore';
import { calculateEarnedPoints } from '../utils/loyaltyPoints';

interface CustomerState {
  customers: Customer[];
  addCustomer: (c: Customer) => void;
  updateCustomer: (id: string, data: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;
  recordVisit: (id: string, amount: number) => void;
  revertVisit: (id: string, amount: number) => void;
  // v4.7 TO DO 12.2.2 (P-A8): manajemen poin loyalty
  addLoyaltyPoints: (id: string, points: number) => void;
  deductLoyaltyPoints: (id: string, points: number) => void;
  loadFromCloud: (fullSync?: boolean) => Promise<void>;
}

export const useCustomerStore = create<CustomerState>()(
  persist(
    (set, get) => ({
      customers: [],

      addCustomer: (c) => {
        set((s) => ({ customers: [...s.customers, c] }));
        syncCustomer(c);
      },

      updateCustomer: (id, data) => {
        set((s) => ({
          customers: s.customers.map((c) =>
            c.id === id ? { ...c, ...data } : c
          ),
        }));
        const updated = get().customers.find((c) => c.id === id);
        if (updated) syncCustomer(updated);
      },

      deleteCustomer: (id) => {
        deleteCustomerCloud(id);
        set((s) => ({ customers: s.customers.filter((c) => c.id !== id) }));
      },

      // v4.7 TO DO 12.2.2 (P-A8): recordVisit juga memberi POIN loyalty saat checkout
      // (earning dihitung dari totalAmount via loyaltySettings; nonaktif → 0 poin).
      recordVisit: (id, amount) => {
        const ls = usePromoStore.getState().loyaltySettings;
        const earned = ls.enabled ? calculateEarnedPoints(amount, ls) : 0;
        set((s) => ({
          customers: s.customers.map((c) =>
            c.id === id
              ? {
                  ...c,
                  visitCount: c.visitCount + 1,
                  totalSpent: c.totalSpent + amount,
                  loyaltyPoints: (c.loyaltyPoints || 0) + earned,
                  lastVisit: new Date().toISOString(),
                }
              : c
          ),
        }));
        const updated = get().customers.find((c) => c.id === id);
        if (updated) syncCustomer(updated);
      },

      // v4.7 TO DO 12.2.2 (P-A8): void/cancel/refund — kembalikan poin yang didapat dari transaksi itu
      // (formula yang sama dengan saat earn, sehingga clawback simetris).
      revertVisit: (id, amount) => {
        const ls = usePromoStore.getState().loyaltySettings;
        const clawed = ls.enabled ? calculateEarnedPoints(amount, ls) : 0;
        set((s) => ({
          customers: s.customers.map((c) =>
            c.id === id
              ? {
                  ...c,
                  visitCount: Math.max(0, c.visitCount - 1),
                  totalSpent: Math.max(0, c.totalSpent - amount),
                  loyaltyPoints: Math.max(0, (c.loyaltyPoints || 0) - clawed),
                }
              : c
          ),
        }));
        const updated = get().customers.find((c) => c.id === id);
        if (updated) syncCustomer(updated);
      },

      addLoyaltyPoints: (id, points) => {
        const add = Math.max(0, Math.floor(points || 0));
        if (add === 0) return;
        set((s) => ({
          customers: s.customers.map((c) =>
            c.id === id ? { ...c, loyaltyPoints: (c.loyaltyPoints || 0) + add } : c
          ),
        }));
        const updated = get().customers.find((c) => c.id === id);
        if (updated) syncCustomer(updated);
      },

      deductLoyaltyPoints: (id, points) => {
        const sub = Math.max(0, Math.floor(points || 0));
        if (sub === 0) return;
        set((s) => ({
          customers: s.customers.map((c) =>
            c.id === id
              ? { ...c, loyaltyPoints: Math.max(0, (c.loyaltyPoints || 0) - sub) }
              : c
          ),
        }));
        const updated = get().customers.find((c) => c.id === id);
        if (updated) syncCustomer(updated);
      },

      loadFromCloud: async (fullSync = false) => {
        const cloudData = await fetchCustomersFromCloud();
        if (cloudData !== null) {
          if (cloudData.length > 0) {
            set((s) => {
              const cloudIds = new Set(cloudData.map((c) => c.id));
              let localOnly: Customer[];
              if (fullSync) {
                // Real-time triggered: cloud is authoritative, drop deleted items
                const gracePeriod = 30 * 1000;
                const cutoff = Date.now() - gracePeriod;
                localOnly = s.customers.filter(
                  (c) => !cloudIds.has(c.id) && new Date(c.createdAt).getTime() > cutoff
                );
              } else {
                localOnly = s.customers.filter((c) => !cloudIds.has(c.id));
              }
              return { customers: [...cloudData, ...localOnly] };
            });
          } else if (fullSync) {
            // Cloud has zero customers — if fullSync, respect that (all deleted)
            set((s) => {
              const gracePeriod = 30 * 1000;
              const cutoff = Date.now() - gracePeriod;
              return { customers: s.customers.filter((c) => new Date(c.createdAt).getTime() > cutoff) };
            });
          } else {
            // Cloud is empty on initial load, seed it with local customers
            const localCustomers = get().customers;
            for (const customer of localCustomers) {
              await syncCustomer(customer);
            }
          }
        }
      },
    }),
    { name: 'rempah-customers', storage: createJSONStorage(() => safeStorage) }
  )
);
