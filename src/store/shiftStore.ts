import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import { v4 as uuid } from 'uuid';
import type { CashierShift } from '../types';
import { syncShift, fetchShiftsFromCloud } from '../lib/cloudSync';

interface ShiftState {
  shifts: CashierShift[];
  activeShift: CashierShift | null;
  openShift: (userId: string, userName: string, openingCash: number) => void;
  closeShift: (closingCash: number, totalSales: number, totalTransactions: number, expectedCash: number) => void;
  getActiveShift: () => CashierShift | null;
  getShiftsByUser: (userId: string) => CashierShift[];
  loadFromCloud: () => Promise<void>;
}

export const useShiftStore = create<ShiftState>()(
  persist(
    (set, get) => ({
      shifts: [],
      activeShift: null,

      openShift: (userId, userName, openingCash) => {
        const shift: CashierShift = {
          id: uuid(),
          userId,
          userName,
          openedAt: new Date().toISOString(),
          openingCash,
          totalSales: 0,
          totalTransactions: 0,
          status: 'open',
        };
        // LOGIC-7 fix: Save to both activeShift AND shifts array
        // so data survives app crashes before closeShift
        set((s) => ({
          activeShift: shift,
          shifts: [shift, ...s.shifts],
        }));
        syncShift(shift);
      },

      closeShift: (closingCash, totalSales, totalTransactions, expectedCash) => {
        const active = get().activeShift;
        if (!active) return;

        const closed: CashierShift = {
          ...active,
          closedAt: new Date().toISOString(),
          closingCash,
          expectedCash,
          cashDifference: closingCash - expectedCash,
          totalSales,
          totalTransactions,
          status: 'closed',
        };

        // LOGIC-7 fix: Update the existing entry in shifts array (not prepend)
        set((s) => ({
          shifts: s.shifts.map((sh) => (sh.id === closed.id ? closed : sh)),
          activeShift: null,
        }));
        syncShift(closed);
      },

      getActiveShift: () => get().activeShift,

      getShiftsByUser: (userId) =>
        get().shifts.filter((s) => s.userId === userId),

      // BUG-C3 fix: Load shifts from cloud for multi-device visibility
      loadFromCloud: async () => {
        const cloudShifts = await fetchShiftsFromCloud();
        if (cloudShifts && cloudShifts.length > 0) {
          let currentUser = null;
          try {
            const authModule = await import('./authStore');
            currentUser = authModule.useAuthStore.getState().currentUser;
          } catch (e) {
            console.warn('Failed to load currentUser in shiftStore:', e);
          }

          set((s) => {
            const cloudIds = new Set(cloudShifts.map((sh) => sh.id));
            // Keep local shifts not yet in cloud
            const localOnly = s.shifts.filter((sh) => !cloudIds.has(sh.id));

            // BUG-NEW-05 / BUG-MED-05 / BUG-MED-02 fix: Check if activeShift was closed from another device or needs restore
            let updatedActiveShift = s.activeShift;
            if (updatedActiveShift) {
              const cloudVersion = cloudShifts.find((sh) => sh.id === updatedActiveShift!.id);
              if (cloudVersion && cloudVersion.status === 'closed') {
                updatedActiveShift = null;
              }
            } else if (currentUser) {
              // Local activeShift is null, restore from cloud if there is a matching open shift for current user
              const openCloudShift = cloudShifts.find(
                (sh) => sh.userId === currentUser.id && sh.status === 'open'
              );
              if (openCloudShift) {
                updatedActiveShift = openCloudShift;
              }
            }

            return {
              shifts: [...cloudShifts, ...localOnly],
              activeShift: updatedActiveShift,
            };
          });
        }
      },
    }),
    { name: 'rempah-shifts', storage: createJSONStorage(() => safeStorage) }
  )
);
