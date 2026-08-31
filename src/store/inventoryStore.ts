import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import { v4 as uuid } from 'uuid';
import type { InventoryItem } from '../types';
import { seedInventory } from '../utils/seed';
import { useStockLogStore } from './stockLogStore';
import type { StockLogEntry } from './stockLogStore';
import { useToastStore } from './toastStore';
import { syncInventoryItem, syncInventoryStock, deleteInventoryCloud, fetchInventoryFromCloud, adjustInventoryStockCloud, type InventoryAdjustment } from '../lib/cloudSync';
// v4.7 TO DO 18.8 (A5): last-write-wins lintas device — fetch cloud stale tidak boleh
// menimpa mutasi lokal yang lebih baru (race sync stok burst multi-device).
import { isLocalNewer } from '../utils/inventoryFreshness';
import { isFactoryResetSeedSkip, clearFactoryResetSeedSkip } from '../utils/factoryResetFlag';
// v4.10 PRIORITAS 28.1: guard push seed inventaris murni ke cloud
import { setCatalogTouched, isCatalogTouched } from '../utils/seedGuard';
import { findNegativeStocksAfterDeduction, type NegativeStockAlert } from '../utils/stockCheck';
import { planCsvImportRow, type ParsedImportRow } from '../utils/stockImport';
// v4.7 TO DO 13.5 (O-7): deteksi potensi konflik stok lintas device saat sync
import { detectStockConflicts, type StockConflict } from '../utils/stockConflict';

// v4.7 TO DO 18.1 (Prioritas 18): tangani deduksi yang DITOLAK cloud (oversell lintas device).
// RPC atomik menolak deduksi bila stok cloud < jumlah — berarti bahan kemungkinan sudah
// terjual perangkat lain. Tindakan: koreksi stok lokal ke nilai cloud (sumber kebenaran
// lintas device) + jejak stock log 'adjust' + toast warning (cek stok fisik).
function handleStockAdjustmentConflicts(
  conflicts: { id: string; delta: number; cloudStock: number }[]
) {
  if (conflicts.length === 0) return;
  const items = useInventoryStore.getState().items;
  const corrections: { id: string; name: string; unit: string; from: number; to: number }[] = [];
  for (const c of conflicts) {
    const item = items.find((i) => i.id === c.id);
    if (!item) continue;
    const corrected = Math.max(0, c.cloudStock);
    corrections.push({ id: c.id, name: item.name, unit: item.unit, from: item.stock, to: corrected });
    useStockLogStore.getState().addLog({
      id: uuid(),
      inventoryId: c.id,
      inventoryName: item.name,
      type: 'adjust',
      amount: corrected - item.stock,
      stockBefore: item.stock,
      stockAfter: corrected,
      unit: item.unit,
      reason: 'Konflik lintas device: deduksi ditolak cloud (stok sudah terjual perangkat lain)',
      date: new Date().toISOString(),
    });
  }
  if (corrections.length === 0) return;
  useInventoryStore.setState((s) => ({
    items: s.items.map((i) => {
      const corr = corrections.find((x) => x.id === i.id);
      return corr ? { ...i, stock: corr.to } : i;
    }),
  }));
  const list = corrections
    .slice(0, 2)
    .map((x) => `${x.name} → ${x.to} ${x.unit}`)
    .join(', ');
  const more = corrections.length > 2 ? ` +${corrections.length - 2} bahan lain` : '';
  useToastStore.getState().addToast(
    `⚠️ Stok ${list}${more} dikoreksi: kemungkinan sudah terjual perangkat lain. Periksa stok fisik.`,
    'warning',
    8000
  );
}

interface InventoryState {
  items: InventoryItem[];
  // v4.7 TO DO 8.4: item yang jadi negatif oleh deduksi terakhir (transient — untuk warning UI/test)
  lastNegativeStockAlerts: NegativeStockAlert[];
  // v4.7 TO DO 13.5 (O-7): potensi konflik stok lintas device (cloud > lokal saat merge).
  // Tidak dipersist — dibangun ulang tiap loadFromCloud; dikosongkan via "Pahami" di UI.
  stockConflicts: StockConflict[];
  clearStockConflicts: () => void;
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
      stockConflicts: [],

      clearStockConflicts: () => set({ stockConflicts: [] }),

      addItem: (item, options) => {
        setCatalogTouched(); // 28.1: user tambah item → bukan seed murni
        // v4.7 TO DO 18.8 (A5): stamp updatedAt saat pembuatan (last-write-wins lintas device)
        const stamped = { ...item, updatedAt: item.updatedAt || new Date().toISOString() };
        if (!options?.skipSync) syncInventoryItem(stamped); // Cloud sync
        set((s) => ({ items: [...s.items, stamped] }));
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
        // v4.7 TO DO 18.8 (A5): stamp updatedAt pada setiap mutasi (last-write-wins)
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, ...data, updatedAt: new Date().toISOString() } : i)),
        }));
        // Cloud sync the updated item (skipSync: pemanggil batch menyiapkan sync sendiri — TO DO 9.4)
        const updated = get().items.find((i) => i.id === id);
        if (updated && !options?.skipSync) syncInventoryItem(updated);
      },

      deleteItem: (id) => {
        setCatalogTouched(); // 28.1: user hapus item → bukan seed murni
        deleteInventoryCloud(id); // Cloud sync
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      },

      deductStock: (deductions, reason) => {
        const items = get().items;
        // 🏷️ v4.9.2: Kumpulkan semua log pemotongan bahan dan kirim bulk
        const newLogs: StockLogEntry[] = [];
        for (const [invId, amount] of Object.entries(deductions)) {
          const item = items.find((i) => i.id === invId);
          if (item && amount > 0) {
            newLogs.push({
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
        if (newLogs.length > 0) {
          useStockLogStore.getState().addLogsBulk(newLogs);
        }
        set((s) => ({
          items: s.items.map((i) => {
            const amount = deductions[i.id];
            // v4.7 TO DO 18.8 (A5): stamp updatedAt pada item yang stoknya berubah
            if (amount) return { ...i, stock: i.stock - amount, updatedAt: new Date().toISOString() }; // LOGIC-5 fix: Allow negative stock values
            return i;
          }),
        }));
        // v4.7 TO DO 18.1 (Prioritas 18): ganti tulis nilai ABSOLUT (rapuh lost-update 2 kasir)
        // dengan penyesuaian DELTA ATOMIK via RPC `adjust_inventory_stock` — guard stok di level
        // database mencegah dua kasir memotong bahan sama melebihi fisik. Deduksi yang ditolak
        // cloud (oversell) → koreksi stok lokal + log + toast (lihat handleStockAdjustmentConflicts).
        const updatedItems = get().items;
        const adjustments: InventoryAdjustment[] = Object.keys(deductions).map((id) => ({
          id,
          delta: -(deductions[id] || 0),
        }));
        adjustInventoryStockCloud(adjustments, updatedItems).then((res) => {
          handleStockAdjustmentConflicts(res.conflicts);
        });

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
            // v4.7 TO DO 18.8 (A5): stamp updatedAt pada item yang stoknya berubah
            if (amount) return { ...i, stock: i.stock + amount, updatedAt: new Date().toISOString() };
            return i;
          }),
        }));
        // v4.7 TO DO 18.1 (Prioritas 18): revert pakai jalur DELTA ATOMIK yang sama (delta positif
        // selalu diizinkan RPC — menambah stok tidak pernah konflik). Fallback absolut bila offline.
        const updatedItems = get().items;
        const adjustments: InventoryAdjustment[] = Object.keys(deductions).map((id) => ({
          id,
          delta: deductions[id] || 0,
        }));
        adjustInventoryStockCloud(adjustments, updatedItems).then((res) => {
          handleStockAdjustmentConflicts(res.conflicts);
        });
        // v4.7 TO DO 18.8 (A12): bersihkan alert stok negatif HANYA bila revert benar-benar
        // memperbaiki item yang negatif. Sebelumnya revert APA PUN (mis. koreksi delta pending
        // kecil yang tidak menyentuh item negatif) menghapus peringatan yang masih relevan →
        // banner hilang lebih cepat dari seharusnya. Item yang MASIH negatif dipertahankan
        // dengan stok terbarunya.
        const currentNegatives = get().lastNegativeStockAlerts;
        if (currentNegatives.length > 0) {
          const afterItems = get().items;
          const stillNegative = currentNegatives
            .map((n) => {
              const item = afterItems.find((i) => i.id === n.inventoryId);
              return item && item.stock < 0 ? { ...n, stock: item.stock } : null;
            })
            .filter((x): x is NegativeStockAlert => x !== null);
          set({ lastNegativeStockAlerts: stillNegative });
        }
      },

      // v4.7 TO DO 9.4: ubah stok banyak item dalam SATU setState + SATU syncInventoryStock bulk.
      // Pemanggil menyiapkan stock log sendiri (reason khusus opname/import) — ini jalur sync saja.
      applyBulkStock: (entries) => {
        if (entries.length === 0) return;
        // v4.7 TO DO 18.8 (A5): stamp updatedAt pada item yang diubah
        const now = new Date().toISOString();
        set((s) => ({
          items: s.items.map((i) => {
            const e = entries.find((x) => x.id === i.id);
            return e ? { ...i, stock: e.stock, updatedAt: now } : i;
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

        const now = new Date().toISOString();
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
                // v4.7 TO DO 18.8 (A5): stamp updatedAt
                updatedAt: now,
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
              // v4.7 TO DO 18.8 (A5): stamp updatedAt
              updatedAt: now,
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
              // v4.7 TO DO 13.5 (O-7): snapshot stok lokal SEBELUM merge untuk deteksi konflik
              const localBefore = new Map(s.items.map((i) => [i.id, i]));
              const cloudIds = new Set(cloudItems.map((i) => i.id));
              // v4.7 TO DO 18.8 (A5): last-write-wins PER ITEM.
              //  - fullSync: item lokal yang LEBIH BARU (updatedAt) dipertahankan (mutasi belum
              //    tersinkron ke cloud) & versi cloud yang dikalahkan TIDAK di-merge (anti duplikat);
              //    item legacy tanpa updatedAt → cloud otoritatif (perilaku lama).
              //  - non-fullSync (realtime): perilaku lama — cloud menggantikan item bersama,
              //    item lokal-only tetap dipertahankan.
              let localOnly: InventoryItem[];
              let cloudForMerge: InventoryItem[];
              if (fullSync) {
                localOnly = s.items.filter(
                  (i) => cloudIds.has(i.id) && isLocalNewer(i, cloudItems.find((c) => c.id === i.id))
                );
                cloudForMerge = cloudItems.filter(
                  (c) => !isLocalNewer(s.items.find((i) => i.id === c.id), c)
                );
              } else {
                localOnly = s.items.filter((i) => !cloudIds.has(i.id));
                cloudForMerge = cloudItems;
              }
              const detected = detectStockConflicts(localBefore, cloudItems);
              // Gabungkan dengan konflik lama (by id) — "Pahami" mengosongkan; konflik baru
              // yang sama akan muncul lagi di sync berikutnya.
              const conflictsById = new Map(s.stockConflicts.map((c) => [c.ingredientId, c]));
              for (const c of detected) conflictsById.set(c.ingredientId, c);
              return {
                items: [...cloudForMerge, ...localOnly],
                stockConflicts: Array.from(conflictsById.values()).sort((a, b) => b.diff - a.diff),
              };
            });
          } else if (isFactoryResetSeedSkip()) {
            // v4.7 TO DO 12.1.3: setelah Factory Reset, jangan push stok demo lokal ke
            // cloud (cloud sengaja dikosongkan). Flag dipakai sekali.
            clearFactoryResetSeedSkip();
          } else {
            // 28.1: cloud kosong — jangan push seed murni ke cloud.
            // Hanya push bila inventaris lokal BUKAN seed murni.
            const localItems = get().items;
            // Inventaris seed punya id 'seed-*' — cek langsung
            const isPureInventorySeed = localItems.every((i) =>
              seedInventory.some((si) => si.id === i.id)
            ) && !isCatalogTouched();
            if (!isPureInventorySeed) {
              for (const item of localItems) {
                await syncInventoryItem(item);
              }
            }
          }
        }
      },
    }),
    {
      name: 'rempah-inventory',
      storage: createJSONStorage(() => safeStorage),
      // v4.7 TO DO 13.5 (O-7): stockConflicts transient TIDAK dipersist (dibangun ulang tiap sync)
      partialize: (s) => ({ items: s.items, lastNegativeStockAlerts: s.lastNegativeStockAlerts }),
    }
  )
);
