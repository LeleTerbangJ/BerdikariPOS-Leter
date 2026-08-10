import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import type { StockOpname } from '../types';
import { syncStockOpname, fetchStockOpnamesFromCloud } from '../lib/cloudSync';

interface StockOpnameState {
  records: StockOpname[];
  addRecord: (record: StockOpname) => void;
  getRecordsByDateRange: (from: Date, to: Date) => StockOpname[];
  loadFromCloud: () => Promise<void>;
}

export const useStockOpnameStore = create<StockOpnameState>()(
  persist(
    (set, get) => ({
      records: [],

      addRecord: (record) => {
        set((s) => ({ records: [record, ...s.records].slice(0, 1000) }));
        syncStockOpname(record);
      },

      getRecordsByDateRange: (from, to) =>
        get().records.filter((r) => {
          const d = new Date(r.date);
          return d >= from && d <= to;
        }),

      loadFromCloud: async () => {
        const cloudRecords = await fetchStockOpnamesFromCloud();
        if (cloudRecords && cloudRecords.length > 0) {
          set((s) => {
            const cloudIds = new Set(cloudRecords.map((r) => r.id));
            const localOnly = s.records.filter((r) => !cloudIds.has(r.id));
            const merged = [...cloudRecords, ...localOnly];
            merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            return { records: merged.slice(0, 1000) };
          });
        }
      },
    }),
    { name: 'rempah-stock-opnames', storage: createJSONStorage(() => safeStorage) }
  )
);
