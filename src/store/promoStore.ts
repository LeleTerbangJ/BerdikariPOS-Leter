import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import type { Promo, LoyaltySettings } from '../types';
import { syncPromo, deletePromoCloud, fetchPromosFromCloud, syncLoyaltySettings, fetchLoyaltySettingsFromCloud } from '../lib/cloudSync';

export interface PromoUsageReservation {
  ok: boolean;
  // true bila usageKey sudah pernah tercatat (replay idempoten — tidak ada perubahan)
  idempotent?: boolean;
  reason?: 'not-found' | 'limit-reached' | 'customer-limit-reached';
}

interface PromoState {
  promos: Promo[];
  loyaltySettings: LoyaltySettings;
  addPromo: (promo: Promo) => void;
  updatePromo: (id: string, data: Partial<Promo>) => void;
  deletePromo: (id: string) => void;
  incrementUsage: (id: string, customerId?: string) => void;
  // v4.7 TO DO 18.8 (E7): cek-dan-naikkan SECARA ATOMIK dari STORE saat commit (bukan render) +
  // ledger usageKey id unik (anti double-increment saat replay transaksi yang sama).
  reservePromoUsage: (id: string, customerId?: string, usageKey?: string) => PromoUsageReservation;
  getActivePromos: () => Promo[];
  getPromoByCode: (code: string) => Promo | undefined;
  updateLoyaltySettings: (data: Partial<LoyaltySettings>) => void;
  getCustomerTier: (visitCount: number) => 'none' | 'bronze' | 'silver' | 'gold';
  getCustomerDiscount: (visitCount: number) => number;
  loadFromCloud: (fullSync?: boolean) => Promise<void>;
}

export const usePromoStore = create<PromoState>()(
  persist(
    (set, get) => ({
      promos: [],
      loyaltySettings: {
        enabled: false,
        pointsPerTransaction: 1,
        pointsPerRupiah: 10000,
        redeemPointsValue: 1000,
        tierBronzeMinVisits: 5,
        tierSilverMinVisits: 15,
        tierGoldMinVisits: 30,
        tierBronzeDiscount: 5,
        tierSilverDiscount: 10,
        tierGoldDiscount: 15,
      },

      addPromo: (promo) => {
        set((s) => ({ promos: [...s.promos, promo] }));
        syncPromo(promo);
      },

      updatePromo: (id, data) => {
        set((s) => ({
          promos: s.promos.map((p) => (p.id === id ? { ...p, ...data } : p)),
        }));
        const updated = get().promos.find((p) => p.id === id);
        if (updated) syncPromo(updated);
      },

      deletePromo: (id) => {
        deletePromoCloud(id);
        set((s) => ({ promos: s.promos.filter((p) => p.id !== id) }));
      },

      // v4.7 TO DO 12.2.6 (P-A6): ikut mencatat pemakaian per pelanggan bila customerId diberikan
      // (transaksi memakai promo dengan batas per pelanggan). Map usageByCustomer disinkronkan
      // bersama promo — pola sama dengan usageCount global (last-write-wins lintas device).
      incrementUsage: (id, customerId) => {
        set((s) => ({
          promos: s.promos.map((p) => {
            if (p.id !== id) return p;
            const usageByCustomer = customerId
              ? { ...(p.usageByCustomer || {}), [customerId]: (p.usageByCustomer?.[customerId] || 0) + 1 }
              : p.usageByCustomer;
            return { ...p, usageCount: p.usageCount + 1, usageByCustomer };
          }),
        }));
        const updated = get().promos.find((p) => p.id === id);
        if (updated) syncPromo(updated);
      },

      // v4.7 TO DO 18.8 (E7): reservePromoUsage — guard race pemakaian promo.
      // (1) Cek batas dari STORE saat ini (bukan salinan render yang bisa stale lintas device);
      // (2) naikkan secara ATOMIK dalam SATU functional set (read-modify-write aman per device);
      // (3) usageKey id unik (id transaksi) → re-commit/replay transaksi yang sama TIDAK
      //     menaikkan usage dua kali (idempoten).
      // Catatan batasan (terdokumentasi di ANALYSE E7): DUA device offline yang memakai voucher
      // sama hampir bersamaan tetap bisa lolos batas karena sync promo memakai last-write-wins
      // per record — proteksi penuh lintas device butuh RPC counter (pola 18.2 queue counters).
      reservePromoUsage: (id, customerId, usageKey) => {
        const existing = get().promos.find((p) => p.id === id);
        if (!existing) return { ok: false, reason: 'not-found' };

        // Replay transaksi yang sama (usageKey sudah tercatat) → idempoten, jangan increment lagi
        if (usageKey && existing.usageKeys?.[usageKey]) {
          return { ok: true, idempotent: true };
        }

        // Pre-check dari store saat ini (lapisan pertama; diulang di dalam updater untuk
        // state terbaru — dua panggilan berurutan di device sama tidak bisa lolos ganda)
        if (existing.usageLimit && existing.usageCount >= existing.usageLimit) {
          return { ok: false, reason: 'limit-reached' };
        }
        if (
          customerId &&
          existing.usageLimitPerCustomer &&
          (existing.usageByCustomer?.[customerId] || 0) >= existing.usageLimitPerCustomer
        ) {
          return { ok: false, reason: 'customer-limit-reached' };
        }

        let applied = false;
        set((s) => {
          const p = s.promos.find((x) => x.id === id);
          if (!p) return s;
          // Re-check di dalam updater (state paling baru)
          if (p.usageLimit && p.usageCount >= p.usageLimit) return s;
          if (
            customerId &&
            p.usageLimitPerCustomer &&
            (p.usageByCustomer?.[customerId] || 0) >= p.usageLimitPerCustomer
          ) {
            return s;
          }
          const usageByCustomer = customerId
            ? { ...(p.usageByCustomer || {}), [customerId]: (p.usageByCustomer?.[customerId] || 0) + 1 }
            : p.usageByCustomer;
          const usageKeys = usageKey
            ? { ...(p.usageKeys || {}), [usageKey]: true as const }
            : p.usageKeys;
          applied = true;
          return {
            promos: s.promos.map((x) =>
              x.id === id ? { ...p, usageCount: p.usageCount + 1, usageByCustomer, usageKeys } : x
            ),
          };
        });

        if (applied) {
          const updated = get().promos.find((p) => p.id === id);
          if (updated) syncPromo(updated);
          return { ok: true };
        }
        // Kalah race dengan panggilan lain di device yang sama (updater menolak)
        return { ok: false, reason: 'limit-reached' };
      },

      getActivePromos: () => {
        const now = new Date();
        return get().promos.filter(
          (p) =>
            p.isActive &&
            new Date(p.startDate) <= now &&
            new Date(p.endDate) >= now &&
            (!p.usageLimit || p.usageCount < p.usageLimit)
        );
      },

      getPromoByCode: (code) => {
        const now = new Date();
        return get().promos.find(
          (p) =>
            p.code?.toLowerCase() === code.toLowerCase() &&
            p.isActive &&
            new Date(p.startDate) <= now &&
            new Date(p.endDate) >= now &&
            (!p.usageLimit || p.usageCount < p.usageLimit)
        );
      },

      // BUG-M5 fix: Sync loyalty settings to cloud when updated
      updateLoyaltySettings: (data) => {
        set((s) => ({ loyaltySettings: { ...s.loyaltySettings, ...data } }));
        const updated = { ...get().loyaltySettings, ...data };
        syncLoyaltySettings(updated);
      },

      getCustomerTier: (visitCount) => {
        const ls = get().loyaltySettings;
        if (!ls.enabled) return 'none';
        if (visitCount >= ls.tierGoldMinVisits) return 'gold';
        if (visitCount >= ls.tierSilverMinVisits) return 'silver';
        if (visitCount >= ls.tierBronzeMinVisits) return 'bronze';
        return 'none';
      },

      getCustomerDiscount: (visitCount) => {
        const ls = get().loyaltySettings;
        if (!ls.enabled) return 0;
        const tier = get().getCustomerTier(visitCount);
        switch (tier) {
          case 'gold': return ls.tierGoldDiscount;
          case 'silver': return ls.tierSilverDiscount;
          case 'bronze': return ls.tierBronzeDiscount;
          default: return 0;
        }
      },

      loadFromCloud: async (fullSync = false) => {
        const cloudPromos = await fetchPromosFromCloud();
        if (cloudPromos !== null) {
          if (cloudPromos.length > 0) {
            set((s) => {
              const cloudIds = new Set(cloudPromos.map((p) => p.id));
              let localOnly: Promo[];
              if (fullSync) {
                localOnly = []; // Trust cloud completely for promos
              } else {
                localOnly = s.promos.filter((p) => !cloudIds.has(p.id));
              }
              // v4.7 TO DO 18.8 (E7): ledger usageKeys bersifat MONOTONIK (key yang tercatat di
              // mana pun adalah pemakaian nyata) — gabungkan UNION dengan versi lokal agar
              // replay transaksi tetap terdeteksi lintas device, bukan ditimpa last-write-wins.
              const merged = cloudPromos.map((cp) => {
                const local = s.promos.find((p) => p.id === cp.id);
                if (!local?.usageKeys && !cp.usageKeys) return cp;
                return { ...cp, usageKeys: { ...(local?.usageKeys || {}), ...(cp.usageKeys || {}) } };
              });
              return { promos: [...merged, ...localOnly] };
            });
          } else {
            // Cloud is empty, seed it with local promos
            const localPromos = get().promos;
            for (const promo of localPromos) {
              await syncPromo(promo);
            }
          }
        }
        // BUG-M5 fix: Load loyalty settings from cloud
        const cloudLoyalty = await fetchLoyaltySettingsFromCloud();
        if (cloudLoyalty !== null) {
          set({ loyaltySettings: cloudLoyalty });
        } else {
          // Cloud has no loyalty settings, sync our local ones
          const localLoyalty = get().loyaltySettings;
          await syncLoyaltySettings(localLoyalty);
        }
      },
    }),
    { name: 'rempah-promos', storage: createJSONStorage(() => safeStorage) }
  )
);
