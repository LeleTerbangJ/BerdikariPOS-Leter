import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import { capEntries, DEFAULT_STOCK_LOG_CAP } from '../utils/storagePrune';
import { syncStockLog, syncStockLogsBulk, fetchStockLogsFromCloud } from '../lib/cloudSync';

export type StockLogType = 'deduct' | 'add' | 'adjust' | 'import';

export interface StockLogEntry {
  id: string;
  inventoryId: string;
  inventoryName: string;
  type: StockLogType;
  amount: number; // positive = added, negative = deducted
  stockBefore: number;
  stockAfter: number;
  unit: string;
  reason?: string; // e.g. "Transaksi #5", "Adjustment manual"
  date: string; // ISO
}

interface StockLogState {
  logs: StockLogEntry[];
  addLog: (entry: StockLogEntry) => void;
  // 🏷️ v4.9.2: Tambah bulk logs untuk efisiensi jaringan
  addLogsBulk: (entries: StockLogEntry[]) => void;
  getLogsByItem: (inventoryId: string) => StockLogEntry[];
  clearOldLogs: (daysToKeep?: number) => void;
  loadFromCloud: () => Promise<void>;
}

export const useStockLogStore = create<StockLogState>()(
  persist(
    (set, get) => ({
      logs: [],

      addLog: (entry) => {
        set((s) => ({ logs: capEntries([entry, ...s.logs], DEFAULT_STOCK_LOG_CAP) })); // v4.5 TO DO 6.1: cap lokal 500 (selaras limit fetch cloud 500)
        // BUG-C4 fix: Sync stock logs to cloud
        syncStockLog(entry);
      },

      // 🏷️ v4.9.2: Catat banyak log stok sekaligus dalam 1 mutasi state & 1 request bulk sync
      addLogsBulk: (entries) => {
        if (!entries || entries.length === 0) return;
        set((s) => ({ logs: capEntries([...entries, ...s.logs], DEFAULT_STOCK_LOG_CAP) }));
        syncStockLogsBulk(entries);
      },

      getLogsByItem: (inventoryId) =>
        get().logs.filter((l) => l.inventoryId === inventoryId),

      clearOldLogs: (daysToKeep = 30) => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysToKeep);
        set((s) => ({ logs: s.logs.filter((l) => new Date(l.date) >= cutoff) }));
      },

      // BUG-C4 fix: Load stock logs from cloud for multi-device visibility
      loadFromCloud: async () => {
        const cloudLogs = await fetchStockLogsFromCloud();
        if (cloudLogs && cloudLogs.length > 0) {
          set((s) => {
            const cloudIds = new Set(cloudLogs.map((l) => l.id));
            const localOnly = s.logs.filter((l) => !cloudIds.has(l.id));
            const merged = [...cloudLogs, ...localOnly];
            merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            return { logs: capEntries(merged, DEFAULT_STOCK_LOG_CAP) };
          });
        }
      },
    }),
    { name: 'rempah-stock-logs', storage: createJSONStorage(() => safeStorage) }
  )
);
