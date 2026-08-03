import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type { CashMovement, CashMovementType } from '../types';
import { syncCashMovement, fetchCashMovementsFromCloud, deleteCashMovementCloud } from '../lib/cloudSync';

// Track IDs that are currently being synced to cloud.
// This prevents loadFromCloud from discarding entries that are mid-sync.
const pendingSyncIds = new Set<string>();

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

        // 2) Mark as pending sync so loadFromCloud won't discard it
        pendingSyncIds.add(movement.id);

        // 3) Sync to cloud with retry
        syncCashMovement(movement)
          .then(() => {
            console.log('[CashMovement] Synced to cloud:', movement.id);
          })
          .catch((err) => {
            console.warn('[CashMovement] Cloud sync failed for', movement.id, err);
          })
          .finally(() => {
            pendingSyncIds.delete(movement.id);
          });

        return movement;
      },

      deleteMovement: async (id) => {
        set((s) => ({ movements: s.movements.filter((m) => m.id !== id) }));
        await deleteCashMovementCloud(id);
      },

      deleteMovementLocal: (id) => {
        set((s) => ({ movements: s.movements.filter((m) => m.id !== id) }));
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
          pendingSyncIds.add(id);
          try {
            await syncCashMovement(updated);
          } finally {
            pendingSyncIds.delete(id);
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
          set((s) => {
            const cloudIds = new Set(cloudMovements.map((m) => m.id));
            // Keep local entries that are:
            // 1. Not yet in cloud (pending sync or offline)
            // 2. Currently being synced (in pendingSyncIds)
            const localOnly = s.movements.filter(
              (m) => !cloudIds.has(m.id)
            );
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
