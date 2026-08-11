import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import { v4 as uuid } from 'uuid';
import type { CashMovement, CashMovementType } from '../types';
import { fetchCashMovementsFromCloud, deleteCashMovementCloud, syncCashMovement } from '../lib/cloudSync';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface CashMovementState {
  movements: CashMovement[];
  /**
   * v4.6 fix #3: ID movement yang sudah TERKONFIRMASI tersinkron ke cloud.
   * Entri di movements yang id-nya TIDAK ada di daftar ini = "Belum Sync" (badge di UI).
   * Tidak dipersist — dibangun ulang dari cloud saat loadFromCloud sukses.
   */
  confirmedSyncIds: string[];
  addMovement: (
    type: CashMovementType,
    amount: number,
    category: string,
    notes: string | undefined,
    cashierId: string,
    cashierName: string,
    shiftId?: string,
    customDate?: string
  ) => CashMovement;
  deleteMovement: (id: string) => Promise<void>;
  deleteMovementLocal: (id: string) => void;
  updateMovement: (
    id: string,
    updates: Partial<Pick<CashMovement, 'type' | 'amount' | 'category' | 'notes'>>
  ) => Promise<CashMovement | null>;
  getMovementsByShift: (shiftId: string) => CashMovement[];
  getMovementsByDateRange: (from: Date, to: Date) => CashMovement[];
  loadFromCloud: (fullSync?: boolean) => Promise<void>;
}

/**
 * Directly upsert a cash movement to Supabase with multi-column self-healing.
 * Strips invalid/missing columns one at a time and retries up to 3 times.
 * Returns true if successfully synced to cloud.
 * v4.6 fix #3: dipakai sebagai FALLBACK ketika jalur utama (offline queue / smartUpsert)
 * tidak langsung sukses — self-healing strip kolom/nullify UUID melengkapi antrean.
 */
async function directSyncToCloud(movement: CashMovement): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  if (!navigator.onLine) return false;

  const payload: Record<string, any> = {
    id: movement.id,
    shift_id: movement.shiftId || null,
    type: movement.type,
    amount: movement.amount,
    category: movement.category,
    notes: movement.notes || null,
    cashier_id: movement.cashierId || null,
    cashier_name: movement.cashierName,
    date: movement.date,
    created_at: movement.createdAt,
  };

  // Try up to 3 iterations, stripping one bad column each time
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { error } = await supabase.from('cash_movements').upsert(payload);
      if (!error) {
        return true; // Success!
      }

      // Try to self-heal by stripping the offending column
      const msg = error.message || '';
      const colMatch = msg.match(/column ["']?([a-zA-Z0-9_]+)["']? (?:of relation|does not exist)/i) ||
                       msg.match(/Could not find the ["']?([a-zA-Z0-9_]+)["']? column/i);
      if (colMatch && colMatch[1] && payload[colMatch[1]] !== undefined) {
        console.warn(`[CashMovement] Self-healing: stripping column "${colMatch[1]}", retrying...`);
        delete payload[colMatch[1]];
        continue;
      }

      // Check for UUID type errors (cashier_id or shift_id might be UUID columns)
      if (msg.includes('invalid input syntax for type uuid')) {
        // Try nullifying shift_id first, then cashier_id
        if (payload.shift_id !== null) {
          console.warn('[CashMovement] UUID error — nullifying shift_id, retrying...');
          payload.shift_id = null;
          continue;
        }
        if (payload.cashier_id !== null) {
          console.warn('[CashMovement] UUID error — nullifying cashier_id, retrying...');
          payload.cashier_id = null;
          continue;
        }
      }

      console.warn('[CashMovement] Upsert failed:', msg);
      return false;
    } catch (e) {
      console.warn('[CashMovement] Upsert exception:', e);
      return false;
    }
  }

  return false;
}

export const useCashMovementStore = create<CashMovementState>()(
  persist(
    (set, get) => {
      // Tandai id sebagai terkonfirmasi sync (idempoten — badge "Belum Sync" hilang).
      const markConfirmed = (id: string) => {
        set((s) => {
          if (s.confirmedSyncIds.includes(id)) return s;
          return { confirmedSyncIds: [...s.confirmedSyncIds, id] };
        });
      };

      return {
        movements: [],
        confirmedSyncIds: [],

        addMovement: (type, amount, category, notes, cashierId, cashierName, shiftId, customDate) => {
          const now = new Date().toISOString();
          const movement: CashMovement = {
            id: uuid(),
            shiftId,
            type,
            amount,
            category: category || (type === 'in' ? 'Pemasukan Kas' : 'Pengeluaran Kas'),
            notes,
            cashierId,
            cashierName,
            date: customDate || now,
            createdAt: now,
          };

          // 1) Save to local state immediately (instant UI update) — belum terkonfirmasi
          set((s) => ({ movements: [movement, ...s.movements] }));

          // 2) v4.6 fix #3: jalur utama = offline queue (smartUpsert) — online langsung,
          //    offline/gagal antre + flush otomatis saat online (retry berkelanjutan).
          //    Fallback = directSyncToCloud (self-healing strip kolom/nullify UUID).
          void syncCashMovement(movement).then((synced) => {
            if (synced) {
              markConfirmed(movement.id);
              console.log('[CashMovement] ✅ Synced to cloud:', movement.id);
            } else {
              directSyncToCloud(movement).then((ok) => {
                if (ok) {
                  markConfirmed(movement.id);
                  console.log('[CashMovement] ✅ Synced (fallback):', movement.id);
                } else {
                  console.warn('[CashMovement] ⚠️ Di antrean offline queue — badge "Belum Sync" tampil:', movement.id);
                }
              });
            }
          });

          return movement;
        },

        deleteMovement: async (id) => {
          set((s) => ({
            movements: s.movements.filter((m) => m.id !== id),
            confirmedSyncIds: s.confirmedSyncIds.filter((x) => x !== id),
          }));
          await deleteCashMovementCloud(id);
        },

        deleteMovementLocal: (id) => {
          set((s) => ({
            movements: s.movements.filter((m) => m.id !== id),
            confirmedSyncIds: s.confirmedSyncIds.filter((x) => x !== id),
          }));
        },

        updateMovement: async (id, updates) => {
          let updated: CashMovement | null = null;
          set((s) => {
            const next = s.movements.map((m) => {
              if (m.id === id) {
                updated = { ...m, ...updates };
                return updated;
              }
              return m;
            });
            // Edit meng-invalidasi konfirmasi — butuh sync ulang (badge tampil lagi)
            return {
              movements: next,
              confirmedSyncIds: s.confirmedSyncIds.filter((x) => x !== id),
            };
          });
          if (updated) {
            const synced = await syncCashMovement(updated);
            if (synced) {
              markConfirmed(id);
            } else {
              const ok = await directSyncToCloud(updated);
              if (ok) markConfirmed(id);
            }
          }
          return updated;
        },

        getMovementsByShift: (shiftId) =>
          get().movements.filter((m) => m.shiftId === shiftId),

        getMovementsByDateRange: (from, to) =>
          get().movements.filter((m) => {
            const d = new Date(m.date);
            return d >= from && d <= to;
          }),

        loadFromCloud: async (_fullSync = false) => {
          const cloudMovements = await fetchCashMovementsFromCloud();
          if (cloudMovements !== null) {
            const cloudIds = new Set(cloudMovements.map((m) => m.id));
            // Entri lokal yang belum ada di cloud — belum sync (badge "Belum Sync" tetap tampil)
            const localOnly = get().movements.filter((m) => !cloudIds.has(m.id));

            set((s) => {
              // Konfirmasi = (yang sudah terkonfirmasi) ∪ (id yang ada di cloud)
              const confirmed = new Set(s.confirmedSyncIds);
              cloudMovements.forEach((m) => confirmed.add(m.id));
              const merged = [...cloudMovements, ...localOnly];
              merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
              return { movements: merged, confirmedSyncIds: Array.from(confirmed) };
            });

            // v4.6 fix #3: retry berkelanjutan — dorong ulang entri lokal yang belum sync
            // via offline queue (dedup otomatis di addToQueue untuk id yang sama).
            for (const m of localOnly) {
              if (!get().confirmedSyncIds.includes(m.id)) {
                const ok = await syncCashMovement(m);
                if (ok) markConfirmed(m.id);
              }
            }
          }
          // If cloudMovements is null (fetch failed / offline), keep existing local state intact
        },
      };
    },
    {
      name: 'rempah-cash-movements',
      storage: createJSONStorage(() => safeStorage),
      // confirmedSyncIds sengaja TIDAK dipersist — dibangun ulang dari cloud setiap boot,
      // sehingga entri lokal yang belum sync selalu punya kesempatan retry setelah reload.
      partialize: (s) => ({ movements: s.movements }),
    }
  )
);
