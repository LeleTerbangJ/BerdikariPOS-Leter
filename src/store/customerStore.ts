import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import type { Customer } from '../types';
import { syncCustomer, deleteCustomerCloud, fetchCustomersFromCloud } from '../lib/cloudSync';

interface CustomerState {
  customers: Customer[];
  addCustomer: (c: Customer) => void;
  updateCustomer: (id: string, data: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;
  recordVisit: (id: string, amount: number) => void;
  revertVisit: (id: string, amount: number) => void;
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

      recordVisit: (id, amount) => {
        set((s) => ({
          customers: s.customers.map((c) =>
            c.id === id
              ? {
                  ...c,
                  visitCount: c.visitCount + 1,
                  totalSpent: c.totalSpent + amount,
                  lastVisit: new Date().toISOString(),
                }
              : c
          ),
        }));
        const updated = get().customers.find((c) => c.id === id);
        if (updated) syncCustomer(updated);
      },

      revertVisit: (id, amount) => {
        set((s) => ({
          customers: s.customers.map((c) =>
            c.id === id
              ? {
                  ...c,
                  visitCount: Math.max(0, c.visitCount - 1),
                  totalSpent: Math.max(0, c.totalSpent - amount),
                }
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
