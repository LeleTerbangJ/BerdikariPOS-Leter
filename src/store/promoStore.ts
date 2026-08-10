import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import type { Promo, LoyaltySettings } from '../types';
import { syncPromo, deletePromoCloud, fetchPromosFromCloud, syncLoyaltySettings, fetchLoyaltySettingsFromCloud } from '../lib/cloudSync';

interface PromoState {
  promos: Promo[];
  loyaltySettings: LoyaltySettings;
  addPromo: (promo: Promo) => void;
  updatePromo: (id: string, data: Partial<Promo>) => void;
  deletePromo: (id: string) => void;
  incrementUsage: (id: string) => void;
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

      incrementUsage: (id) => {
        set((s) => ({
          promos: s.promos.map((p) =>
            p.id === id ? { ...p, usageCount: p.usageCount + 1 } : p
          ),
        }));
        const updated = get().promos.find((p) => p.id === id);
        if (updated) syncPromo(updated);
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
              return { promos: [...cloudPromos, ...localOnly] };
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
