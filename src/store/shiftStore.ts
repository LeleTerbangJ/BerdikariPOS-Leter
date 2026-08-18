import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import { v4 as uuid } from 'uuid';
import type { CashierShift } from '../types';
import { syncShift, fetchShiftsFromCloud } from '../lib/cloudSync';

export type OpenShiftResult =
  | { ok: true; shift: CashierShift }
  | { ok: false; reason: 'shift-exists'; existing: CashierShift };

interface ShiftState {
  shifts: CashierShift[];
  activeShift: CashierShift | null;
  // v4.7 TO DO 18.3: openShift kini async + guard "1 shift aktif per outlet".
  // Return { ok: false, existing } bila sudah ada shift terbuka (lokal / device lain).
  openShift: (userId: string, userName: string, openingCash: number) => Promise<OpenShiftResult>;
  // v4.7 TO DO 18.3: lanjutkan shift yang sudah dibuka (mis. oleh kasir lain di device
  // berbeda) tanpa menginput modal kas ulang — dipakai OpenShiftModal saat deteksi konflik.
  resumeExistingShift: (shift: CashierShift) => void;
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

      openShift: async (userId, userName, openingCash) => {
        // 18.3 guard: 1 shift aktif per outlet — cek shift terbuka di data lokal
        // (sudah termasuk hasil loadFromCloud) sebelum membuat shift baru.
        const localOpen = get().shifts.find((s) => s.status === 'open');
        if (localOpen) {
          return { ok: false, reason: 'shift-exists', existing: localOpen };
        }
        // Guard cloud (best-effort): device lain bisa membuka shift lebih dulu —
        // dicegah agar tidak muncul 2 shift "aktif" di laporan Shift Manager.
        // Offline / fetch gagal → diizinkan (tidak bisa memverifikasi; 1 shift per device).
        try {
          const cloud = await fetchShiftsFromCloud();
          const cloudOpen = cloud?.find((s) => s.status === 'open');
          if (cloudOpen) {
            return { ok: false, reason: 'shift-exists', existing: cloudOpen };
          }
        } catch (e) {
          console.warn('[Shift] Gagal verifikasi shift cloud saat buka (dilewati):', e);
        }

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
        return { ok: true, shift };
      },

      resumeExistingShift: (shift) => {
        set((s) => {
          const exists = s.shifts.some((x) => x.id === shift.id);
          return {
            activeShift: shift,
            shifts: exists ? s.shifts : [shift, ...s.shifts],
          };
        });
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
      // v4.7 TO DO 18.3: restore shift terbuka PALING AWAL (siapa pun kasirnya) —
      // konsisten dengan model "1 shift aktif per outlet" sehingga semua device
      // menyatu ke shift yang sama (tidak ada lagi 2 shift "aktif" di laporan).
      loadFromCloud: async () => {
        const cloudShifts = await fetchShiftsFromCloud();
        if (cloudShifts && cloudShifts.length > 0) {
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
            }
            if (!updatedActiveShift) {
              // 18.3: 1 shift aktif per outlet — pulihkan shift terbuka PALING AWAL.
              const openShifts = cloudShifts
                .filter((sh) => sh.status === 'open')
                .sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
              if (openShifts.length > 0) {
                updatedActiveShift = openShifts[0];
                if (openShifts.length > 1) {
                  console.warn(
                    `[Shift] Ditemukan ${openShifts.length} shift terbuka di cloud — hanya shift paling awal yang diaktifkan. Tutup shift duplikat secara manual agar laporan akurat.`
                  );
                }
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
