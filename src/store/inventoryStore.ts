import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import { v4 as uuid } from 'uuid';
import type { InventoryItem } from '../types';
import { seedInventory } from '../utils/seed';
import { useStockLogStore } from './stockLogStore';
import type { StockLogEntry } from './stockLogStore';
import { useToastStore } from './toastStore';
import { syncInventoryItem, syncInventoryStock, deleteInventoryCloud, fetchInventoryFromCloud } from '../lib/cloudSync';
import { findNegativeStocksAfterDeduction, type NegativeStockAlert } from '../utils/stockCheck';
import { planCsvImportRow, type ParsedImportRow } from '../utils/stockImport';

interface InventoryState {
  items: InventoryItem[];
  // v4.7 TO DO 8.4: item yang jadi negatif oleh deduksi terakhir (transient — untuk warning UI/test)
  lastNegativeStockAlerts: NegativeStockAlert[];
  addItem: (item: InventoryItem, options?: { skipSync?: boolean }) => void;
  updateItem: (id: string, data: Partial<InventoryItem>, options?: { skipLog?: boolean; skipSync?: boolean }) => void;
  deleteItem: (id: string) => void;
  deductStock: (deductions: Record<string, number>, reason?: string) => void;
  revertStock: (deductions: Record<string, number>, reason?: string) => void;
  // v4.7 TO DO 9.4: batch — SATU setState + SATU syncInventoryStock bulk (opname & sejenisnya)
  applyBulkStock: (entries: { id: string; stock: number }[]) => void;
  // v4.7 TO DO 9.4: import CSV batch — 1 setState untuk semua baris + log 'import' + sync bulk
  importItems: (rows: ParsedImportRow[]) => void;
  getLowStockItems: () => InventoryItem[];
  loadFromCloud: (fullSync?: boolean) => Promise<void>;
}

export const useInventoryStore = create<InventoryState>()(
  persist(
    (set, get) => ({
      items: seedInventory,
      lastNegativeStockAlerts: [],

      addItem: (item, options) => {
        if (!options?.skipSync) syncInventoryItem(item); // Cloud sync
        set((s) => ({ items: [...s.items, item] }));
      },

      updateItem: (id, data, options) => {
        const current = get().items.find((i) => i.id === id);
        // Log stock change if stock was manually adjusted
        if (current && data.stock !== undefined && data.stock !== current.stock && !options?.skipLog) {
          useStockLogStore.getState().addLog({
            id: uuid(),
            inventoryId: id,
            // v4.7 TO DO 9.3: log memakai NAMA BARU bila rename bersamaan (fallback nama lama)
            inventoryName: data.name ?? current.name,
            type: 'adjust',
            amount: data.stock - current.stock,
            stockBefore: current.stock,
            stockAfter: data.stock,
            unit: current.unit,
            reason: 'Adjustment manual',
            date: new Date().toISOString(),
          });
        }
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, ...data } : i)),
        }));
        // Cloud sync the updated item (skipSync: pemanggil batch menyiapkan sync sendiri — TO DO 9.4)
        const updated = get().items.find((i) => i.id === id);
        if (updated && !options?.skipSync) syncInventoryItem(updated);
      },

      deleteItem: (id) => {
        deleteInventoryCloud(id); // Cloud sync
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      },

      deductStock: (deductions, reason) => {
        const items = get().items;
        // Log each deduction
        for (const [invId, amount] of Object.entries(deductions)) {
          const item = items.find((i) => i.id === invId);
          if (item && amount > 0) {
            useStockLogStore.getState().addLog({
              id: uuid(),
              inventoryId: invId,
              inventoryName: item.name,
              type: 'deduct',
              amount: -amount,
              stockBefore: item.stock,
              stockAfter: item.stock - amount, // LOGIC-5 fix: Log actual stock after deduction (could be negative)
              unit: item.unit,
              reason: reason || 'Transaksi POS',
              date: new Date().toISOString(),
            });
          }
        }
        set((s) => ({
          items: s.items.map((i) => {
            const amount = deductions[i.id];
            if (amount) return { ...i, stock: i.stock - amount }; // LOGIC-5 fix: Allow negative stock values
            return i;
          }),
        }));
        // BUG-03 fix: Sync AFTER state update so cloud gets correct post-deduction stock
        // v4.7 TO DO 8.3: jalur sync BULK yang sama dengan revertStock (unifikasi)
        const updatedItems = get().items;
        syncInventoryStock(deductions, updatedItems);

        // v4.7 TO DO 8.4: pantau stok negatif PASCA-deduksi (bukan blokir — LOGIC-5 izinkan negatif).
        // Race 2 device checkout bahan terakhir bersamaan bisa membuat stok negatif tanpa disadari.
        // Dihitung dari stok PRE-deduksi (`items` sebelum setState) — helper menghitung `stock - amount`.
        const negatives = findNegativeStocksAfterDeduction(items, deductions);
        if (negatives.length > 0) {
          const list = negatives
            .slice(0, 3)
            .map((n) => `${n.name} (${n.stock} ${n.unit})`)
            .join(', ');
          const more = negatives.length > 3 ? ` +${negatives.length - 3} bahan lain` : '';
          useToastStore.getState().addToast(`⚠️ Stok negatif: ${list}${more}`, 'warning', 6000);
        }
        set({ lastNegativeStockAlerts: negatives });
      },

      // BUG-K3 fix: Revert stock deductions when transaction is cancelled
      revertStock: (deductions, reason) => {
        const items = get().items;
        // Log each revert
        for (const [invId, amount] of Object.entries(deductions)) {
          const item = items.find((i) => i.id === invId);
          if (item && amount > 0) {
            useStockLogStore.getState().addLog({
              id: uuid(),
              inventoryId: invId,
              inventoryName: item.name,
              type: 'add',
              amount: amount,
              stockBefore: item.stock,
              stockAfter: item.stock + amount,
              unit: item.unit,
              reason: reason || 'Revert transaksi cancel',
              date: new Date().toISOString(),
            });
          }
        }
        set((s) => ({
          items: s.items.map((i) => {
            const amount = deductions[i.id];
            if (amount) return { ...i, stock: i.stock + amount };
            return i;
          }),
        }));
        // v4.7 TO DO 8.3: sync BULK (satu helper dengan deductStock) — sebelumnya loop syncInventoryItem
        const updatedItems = get().items;
        syncInventoryStock(deductions, updatedItems);
        // Revert bisa memperbaiki stok negatif → bersihkan alert terakhir
        set({ lastNegativeStockAlerts: [] });
      },

      // v4.7 TO DO 9.4: ubah stok banyak item dalam SATU setState + SATU syncInventoryStock bulk.
      // Pemanggil menyiapkan stock log sendiri (reason khusus opname/import) — ini jalur sync saja.
      applyBulkStock: (entries) => {
        if (entries.length === 0) return;
        set((s) => ({
          items: s.items.map((i) => {
            const e = entries.find((x) => x.id === i.id);
            return e ? { ...i, stock: e.stock } : i;
          }),
        }));
        const updatedItems = get().items;
        const ids: Record<string, number> = {};
        for (const e of entries) ids[e.id] = 1;
        syncInventoryStock(ids, updatedItems);
      },

      // v4.7 TO DO 9.4: import CSV dalam satu batch — 1 setState untuk semua baris,
      // log tipe 'import' (TO DO 9.1), 1 syncInventoryStock bulk untuk stok, dan
      // syncInventoryItem penuh HANYA untuk item baru / yang field non-stoknya berubah.
      importItems: (rows) => {
        if (rows.length === 0) return;
        const items = get().items;
        const nextItems = items.map((i) => ({ ...i }));
        const logs: Omit<StockLogEntry, 'id' | 'date'>[] = [];
        const stockIds: Record<string, number> = {};
        const fullSync: InventoryItem[] = [];

        for (const row of rows) {
          const existing = items.find((i) => i.id === row.id);
          const plan = planCsvImportRow(existing, row);
          if (plan.action === 'update' && existing) {
            const idx = nextItems.findIndex((i) => i.id === row.id);
            if (idx >= 0) {
              nextItems[idx] = {
                ...nextItems[idx],
                name: row.name,
                stock: row.stock,
                unit: row.unit,
                costPerUnit: row.costPerUnit,
                minStock: row.minStock,
              };
            }
            stockIds[row.id] = 1; // stok → jalur bulk
            const fieldChanged =
              existing.name !== row.name ||
              existing.unit !== row.unit ||
              existing.costPerUnit !== row.costPerUnit ||
              existing.minStock !== row.minStock;
            if (fieldChanged) fullSync.push(nextItems[idx]);
          } else if (plan.action === 'create') {
            nextItems.push({
              id: row.id,
              name: row.name,
              stock: row.stock,
              unit: row.unit,
              costPerUnit: row.costPerUnit,
              minStock: row.minStock,
            });
            stockIds[row.id] = 1;
            fullSync.push(nextItems[nextItems.length - 1]); // baru → perlu upsert penuh
          }
          if (plan.log) logs.push(plan.log);
        }

        set({ items: nextItems });
        for (const l of logs) {
          useStockLogStore.getState().addLog({ id: uuid(), date: new Date().toISOString(), ...l });
        }
        syncInventoryStock(stockIds, nextItems);
        for (const it of fullSync) syncInventoryItem(it);
      },

      getLowStockItems: () => {
        return get().items.filter((i) => i.stock < (i.minStock ?? 3));
      },

      loadFromCloud: async (fullSync = false) => {
        const cloudItems = await fetchInventoryFromCloud();
        if (cloudItems !== null) {
          if (cloudItems.length > 0) {
            set((s) => {
              const cloudIds = new Set(cloudItems.map((i) => i.id));
              let localOnly: InventoryItem[];
              if (fullSync) {
                // Real-time: cloud is authoritative
                localOnly = []; // Trust cloud completely for inventory
              } else {
                localOnly = s.items.filter((i) => !cloudIds.has(i.id));
              }
              return { items: [...cloudItems, ...localOnly] };
            });
          } else {
            // Cloud is empty, seed it with local items
            const localItems = get().items;
            for (const item of localItems) {
              await syncInventoryItem(item);
            }
          }
        }
      },
    }),
    { name: 'rempah-inventory', storage: createJSONStorage(() => safeStorage) }
  )
);
