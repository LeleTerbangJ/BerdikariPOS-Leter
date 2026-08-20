import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import bcrypt from 'bcryptjs';
import type { AppSettings } from '../types';
import { seedSettings } from '../utils/seed';
import { syncSettings, fetchSettingsFromCloud } from '../lib/cloudSync';
import { updateFavicon, updatePageTitle } from '../utils/favicon';
import { useToastStore } from './toastStore';

interface SettingsState {
  settings: AppSettings;
  updateSettings: (data: Partial<AppSettings>) => void;
  verifyPin: (pin: string) => boolean;
  loadFromCloud: () => Promise<void>;
}

// Helper: check if a string is already a bcrypt hash
function isBcryptHash(str: string): boolean {
  return str.startsWith('$2a$') || str.startsWith('$2b$');
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: seedSettings,

      updateSettings: (data: Partial<AppSettings>) => {
        // BUG-M4 fix: Hash PINs before storing
        const processed = { ...data };
        if (processed.managerPin && !isBcryptHash(processed.managerPin)) {
          processed.managerPin = bcrypt.hashSync(processed.managerPin, 8);
        }
        if (processed.superAdminPin && !isBcryptHash(processed.superAdminPin)) {
          processed.superAdminPin = bcrypt.hashSync(processed.superAdminPin, 8);
        }
        set((s: SettingsState) => ({ settings: { ...s.settings, ...processed } }));
        const updated = { ...get().settings, ...processed };
        syncSettings(updated);
        // Update favicon & title if logo/name changed
        if (data.storeLogo !== undefined) updateFavicon(data.storeLogo);
        if (data.storeName !== undefined) updatePageTitle(data.storeName);
      },

      // BUG-M4 fix: Compare PIN with bcrypt (supports both hashed and legacy plaintext)
      verifyPin: (pin: string) => {
        const stored = get().settings.managerPin;
        if (isBcryptHash(stored)) {
          return bcrypt.compareSync(pin, stored);
        }
        // Legacy plaintext comparison (auto-migrate)
        if (stored === pin) {
          // Migrate plaintext PIN to hash
          const hashed = bcrypt.hashSync(pin, 8);
          set((s: SettingsState) => ({ settings: { ...s.settings, managerPin: hashed } }));
          syncSettings({ ...get().settings, managerPin: hashed });
          return true;
        }
        return false;
      },

      loadFromCloud: async () => {
        const cloudSettings = await fetchSettingsFromCloud();
        if (cloudSettings) {
          set((s: SettingsState) => {
            const merged = { ...s.settings };
            // Printer settings are device-specific (hardware bound) and should NOT be overwritten by cloud
            const LOCAL_PRINTER_KEYS = [
              'printerEnabled',
              'printerType',
              'printerWidth',
              'autoPrintOnCheckout',
              'cashierBluetoothDeviceId',
              'cashierBluetoothDeviceName',
              'kitchenPrinters',
              'autoPrintReceipt',
              'autoPrintKitchen',
              'showLogoOnReceipt',
            ];
            Object.keys(cloudSettings).forEach((k) => {
              const key = k as keyof AppSettings;
              if (LOCAL_PRINTER_KEYS.includes(key as string)) return; // Keep device local printer setup!
              const cloudVal = cloudSettings[key];
              if (cloudVal !== undefined && cloudVal !== null) {
                (merged as any)[key] = cloudVal;
              }
            });
            return { settings: merged as AppSettings };
          });
        }
      },
    }),
    {
      name: 'rempah-settings',
      storage: createJSONStorage(() => safeStorage),
      merge: (persistedState: any, currentState: any) => {
        return {
          ...currentState,
          ...persistedState,
          settings: {
            ...currentState.settings,
            ...(persistedState?.settings || {}),
          },
        };
      },
    }
  )
);
