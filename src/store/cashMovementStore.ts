import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type { CashMovement, CashMovementType } from '../types';
import { syncCashMovement, fetchCashMovementsFromCloud, deleteCashMovementCloud } from '../lib/cloudSync';

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
  updateMovement: (
    id: string,
    updates: Partial<Pick<CashMovement, 'type' | 'amount' | 'category' | 'notes'>>
  ) => Promise<CashMovement | null>;
  getMovementsByShift: (shiftId: string) => CashMovement[];
  getMovementsByDateRange: (from: Date, to: Date) => CashMovement[];
  loadFromCloud: () => Promise<void>;
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

        set((s) => ({ movements: [movement, ...s.movements] }));
        syncCashMovement(movement);
        return movement;
      },

      deleteMovement: async (id) => {
        set((s) => ({ movements: s.movements.filter((m) => m.id !== id) }));
        await deleteCashMovementCloud(id);
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
          await syncCashMovement(updated);
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

      loadFromCloud: async () => {
        const cloudMovements = await fetchCashMovementsFromCloud();
        if (cloudMovements && cloudMovements.length > 0) {
          set((s) => {
            const cloudIds = new Set(cloudMovements.map((m) => m.id));
            const localOnly = s.movements.filter((m) => !cloudIds.has(m.id));
            const merged = [...cloudMovements, ...localOnly];
            merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            return { movements: merged };
          });
        }
      },
    }),
    { name: 'rempah-cash-movements' }
  )
);
