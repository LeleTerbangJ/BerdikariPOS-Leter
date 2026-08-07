import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type { CashMovement, CashMovementType } from '../types';
import { fetchCashMovementsFromCloud, deleteCashMovementCloud } from '../lib/cloudSync';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

/**
 * Track IDs that have been confirmed synced to cloud.
 * Entries NOT in this set are treated as "local-only" and will NEVER be
 * overwritten by loadFromCloud — this is the key to preventing data loss.
 */
const confirmedSyncedIds = new Set<string>();

interface CashMovementState {
  movements: CashMovement[];
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
    (set, get) => ({
      movements: [],

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

        // 1) Save to local state immediately (instant UI update)
        set((s) => ({ movements: [movement, ...s.movements] }));

        // 2) Sync to cloud — if successful, mark as confirmed
        directSyncToCloud(movement).then((synced) => {
          if (synced) {
            confirmedSyncedIds.add(movement.id);
            console.log('[CashMovement] ✅ Synced to cloud:', movement.id);
          } else {
            console.warn('[CashMovement] ⚠️ NOT synced (will retry on next load):', movement.id);
            // Retry once more after a delay
            setTimeout(() => {
              directSyncToCloud(movement).then((ok) => {
                if (ok) {
                  confirmedSyncedIds.add(movement.id);
                  console.log('[CashMovement] ✅ Retry synced:', movement.id);
                }
              });
            }, 5000);
          }
        });

        return movement;
      },

      deleteMovement: async (id) => {
        set((s) => ({ movements: s.movements.filter((m) => m.id !== id) }));
        confirmedSyncedIds.delete(id);
        await deleteCashMovementCloud(id);
      },

      deleteMovementLocal: (id) => {
        set((s) => ({ movements: s.movements.filter((m) => m.id !== id) }));
        confirmedSyncedIds.delete(id);
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
          return { movements: next };
        });
        if (updated) {
          const synced = await directSyncToCloud(updated);
          if (synced) confirmedSyncedIds.add(id);
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
          // Mark all cloud entries as confirmed synced
          cloudMovements.forEach((m) => confirmedSyncedIds.add(m.id));

          set((s) => {
            const cloudIds = new Set(cloudMovements.map((m) => m.id));

            // Keep ALL local entries that are NOT in cloud yet.
            // These are entries that were created locally but haven't synced yet.
            const localOnly = s.movements.filter((m) => !cloudIds.has(m.id));

            // Also try to sync any unsynced local entries to cloud
            localOnly.forEach((m) => {
              if (!confirmedSyncedIds.has(m.id)) {
                directSyncToCloud(m).then((ok) => {
                  if (ok) confirmedSyncedIds.add(m.id);
                });
              }
            });

            const merged = [...cloudMovements, ...localOnly];
            merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            return { movements: merged };
          });
        }
        // If cloudMovements is null (fetch failed / offline), keep existing local state intact
      },
    }),
    { name: 'rempah-cash-movements' }
  )
);
