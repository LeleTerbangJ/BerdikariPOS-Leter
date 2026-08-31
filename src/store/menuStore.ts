import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import type { Menu, MenuComponent, ComponentType, ComponentMode } from '../types';
import { seedMenus } from '../utils/seed';
import { syncMenu, deleteMenuCloud, fetchMenusFromCloud, syncCustomCategories, fetchCustomCategoriesFromCloud } from '../lib/cloudSync';
import { fetchComponentsFromCloud, syncComponentToCloud, deleteComponentFromCloud } from '../lib/bundleRepository';
import { useAuditLogStore } from './auditLogStore';
import { useAuthStore } from './authStore';
import { isFactoryResetSeedSkip, clearFactoryResetSeedSkip } from '../utils/factoryResetFlag';
// v4.10 PRIORITAS 28.1: guard push seed murni + 28.3: tombstone deletedMenuIds
import { isPureSeedCatalog, setCatalogTouched } from '../utils/seedGuard';
import { filterTombstoned, pruneConfirmedTombstones, DEFAULT_TOMBSTONE_CAP } from '../utils/storagePrune';
import { useToastStore } from './toastStore';

interface MenuState {
  menus: Menu[];
  menuComponents: MenuComponent[];
  customCategories: string[];
  deletedMenuIds: string[]; // 28.3: tombstone untuk menus (anti re-hidrasi menu terhapus)
  addMenu: (menu: Menu) => void;
  updateMenu: (id: string, data: Partial<Menu>) => void;
  deleteMenu: (id: string) => void;
  importMenus: (menus: Menu[]) => void;
  getCategories: () => string[];
  addCategory: (cat: string) => void;
  deleteCategory: (cat: string) => void;
  reorderCategories: (ordered: string[]) => void;
  addComponent: (component: MenuComponent) => void;
  updateComponent: (id: string, data: Partial<MenuComponent>) => void;
  deleteComponent: (id: string) => void;
  getComponentsByParent: (parentMenuId: string) => MenuComponent[];
  loadFromCloud: (fullSync?: boolean) => Promise<boolean>; // 28.2: return true=bisa dipakai, false=gagal
}

export const useMenuStore = create<MenuState>()(
  persist(
    (set, get) => ({
      menus: seedMenus,
      menuComponents: [],
      customCategories: ['Jamu Murni', 'Wedang', 'Signature', 'Segar', 'Paket Combo'],
      deletedMenuIds: [],

      addMenu: (menu) => {
        setCatalogTouched(); // 28.1: user menambah menu → bukan seed murni
        set((s) => ({ menus: [...s.menus, menu] }));
        syncMenu(menu);
      },

      updateMenu: (id, data) => {
        setCatalogTouched(); // 28.1: user edit menu → bukan seed murni
        set((s) => ({
          menus: s.menus.map((m) => (m.id === id ? { ...m, ...data } : m)),
        }));
        const updatedMenu = get().menus.find((m) => m.id === id);
        if (updatedMenu) syncMenu(updatedMenu);
      },

      deleteMenu: (id) => {
        setCatalogTouched(); // 28.1: user hapus menu → bukan seed murni
        deleteMenuCloud(id);
        set((s) => ({
          menus: s.menus.filter((m) => m.id !== id),
          // 28.3: tombstone id yang dihapus → jangan re-hidrasi dari cloud
          deletedMenuIds: [...s.deletedMenuIds, id].slice(-DEFAULT_TOMBSTONE_CAP),
        }));
      },

      importMenus: (menus) => {
        setCatalogTouched(); // 28.1: import = user aksi → bukan seed murni
        set({ menus, deletedMenuIds: [] });
        // Sync all imported menus to cloud
        for (const menu of menus) {
          syncMenu(menu);
        }
        // Audit log (GAP-5 fix)
        const currentUser = useAuthStore.getState().currentUser;
        if (currentUser) {
          useAuditLogStore.getState().addLog(
            currentUser.id,
            currentUser.name,
            currentUser.role,
            'update_menu',
            `Import menu dari CSV (${menus.length} menu)`,
            { count: menus.length }
          );
        }
      },

      getCategories: () => {
        const fromMenus = new Set(get().menus.map((m) => m.category));
        const fromCustom = new Set(get().customCategories);
        return Array.from(new Set([...fromCustom, ...fromMenus]));
      },

      addCategory: (cat) => {
        set((s) => {
          const updated = s.customCategories.includes(cat)
            ? s.customCategories
            : [...s.customCategories, cat];
          syncCustomCategories(updated); // GAP-1 fix: sync to cloud
          return { customCategories: updated };
        });
      },

      deleteCategory: (cat) => {
        set((s) => {
          const updated = s.customCategories.filter((c) => c !== cat);
          syncCustomCategories(updated); // GAP-1 fix: sync to cloud
          return { customCategories: updated };
        });
      },

      // v4.7 (TO DO 11 — fitur baru): atur urutan badge kategori di POS.
      // Urutan penuh disimpan ke customCategories (urutan = posisi tab) & di-sync ke cloud
      // lewat syncCustomCategories (settings id=1) sehingga konsisten lintas device.
      reorderCategories: (ordered) => {
        set((s) => {
          const deduped = Array.from(new Set(ordered));
          const merged = [
            ...deduped,
            ...s.customCategories.filter((c) => !deduped.includes(c)),
          ];
          syncCustomCategories(merged);
          return { customCategories: merged };
        });
      },

      addComponent: (component) => {
        set((s) => {
          const updated = [...s.menuComponents, component];
          // Update parent menu components
          const parentId = component.parentMenuId;
          const parentComps = updated.filter((c) => c.parentMenuId === parentId);
          const updatedMenus = s.menus.map((m) =>
            m.id === parentId ? { ...m, components: parentComps } : m
          );
          return { menuComponents: updated, menus: updatedMenus };
        });
        syncComponentToCloud(component);
        // Also sync updated parent menu
        const parentMenu = get().menus.find((m) => m.id === component.parentMenuId);
        if (parentMenu) syncMenu(parentMenu);
      },

      updateComponent: (id, data) => {
        set((s) => {
          const updated = s.menuComponents.map((c) => (c.id === id ? { ...c, ...data } : c));
          const comp = updated.find((c) => c.id === id);
          const parentId = comp?.parentMenuId;
          let updatedMenus = s.menus;
          if (parentId) {
            const parentComps = updated.filter((c) => c.parentMenuId === parentId);
            updatedMenus = s.menus.map((m) =>
              m.id === parentId ? { ...m, components: parentComps } : m
            );
          }
          return { menuComponents: updated, menus: updatedMenus };
        });
        const comp = get().menuComponents.find((c) => c.id === id);
        if (comp) syncComponentToCloud(comp);
      },

      deleteComponent: (id) => {
        const comp = get().menuComponents.find((c) => c.id === id);
        const parentId = comp?.parentMenuId;
        deleteComponentFromCloud(id);
        set((s) => {
          const updated = s.menuComponents.filter((c) => c.id !== id);
          let updatedMenus = s.menus;
          if (parentId) {
            const parentComps = updated.filter((c) => c.parentMenuId === parentId);
            updatedMenus = s.menus.map((m) =>
              m.id === parentId ? { ...m, components: parentComps } : m
            );
          }
          return { menuComponents: updated, menus: updatedMenus };
        });
      },

      getComponentsByParent: (parentMenuId) => {
        return get().menuComponents.filter((c) => c.parentMenuId === parentMenuId);
      },

      loadFromCloud: async (fullSync = false) => {
        // Load menus
        const cloudMenus = await fetchMenusFromCloud();
        const cloudComponents = await fetchComponentsFromCloud();

        // 28.2: indikasi fetch gagal — return boolean, toast peringatan
        if (cloudMenus === null) {
          try {
            useToastStore.getState().addToast(
              'Katalog gagal dimuat dari cloud — menampilkan data lokal.',
              'warning',
              5000
            );
          } catch { /* toast belum siap */ }
          return false;
        }

        if (cloudMenus.length > 0) {
          set((s) => {
            const cloudIds = new Set(cloudMenus.map((m) => m.id));
            // 28.3: filter tombstone dari cloudMenus SAAT MERGE (bukan hanya localOnly)
            // agar menu terhapus tidak kembali via cloudMenus (fullSync=true → localOnly=[]
            // tapi cloudMenus tetap perlu di-filter)
            const tombstoned = new Set(s.deletedMenuIds);
            const cloudFiltered = filterTombstoned(cloudMenus, s.deletedMenuIds);
            let localOnly: Menu[];
            if (fullSync) {
              localOnly = [];
            } else {
              localOnly = s.menus.filter((m) => !cloudIds.has(m.id) && !tombstoned.has(m.id));
            }
            const componentsList = cloudComponents !== null ? cloudComponents : s.menuComponents;
            const mergedMenus = cloudFiltered.map((cm) => {
              const local = s.menus.find((lm) => lm.id === cm.id);
              const parentComps = componentsList.filter((c) => c.parentMenuId === cm.id);
              return {
                ...cm,
                components: parentComps,
                showSugarLevel: cm.showSugarLevel !== undefined
                  ? cm.showSugarLevel
                  : (local?.showSugarLevel !== undefined ? local.showSugarLevel : true),
                showTemperature: cm.showTemperature !== undefined
                  ? cm.showTemperature
                  : (local?.showTemperature !== undefined ? local.showTemperature : true),
              };
            });
            // 28.3: prune tombstone — id yang sudah tidak ada di cloud = delete terkonfirmasi
            const prunedTombstones = pruneConfirmedTombstones(s.deletedMenuIds, cloudIds);
            return {
              menus: [...mergedMenus, ...localOnly],
              menuComponents: componentsList,
              deletedMenuIds: prunedTombstones,
            };
          });
        } else if (isFactoryResetSeedSkip()) {
          clearFactoryResetSeedSkip();
        } else {
          // 28.1: cloud kosong — jangan push seed murni ke cloud.
          // Hanya push bila katalog lokal BUKAN seed murni (user sudah tambah/edit/hapus/import
          // → catalogTouched flag diset → isPureSeedCatalog=false → push diperbolehkan).
          // Onboarding fresh deployment tetap jalan: device pertama dgn katalog user → push.
          // Seed demo TIDAK ter-upload → menu demo tidak bandel.
          const localMenus = get().menus;
          if (!isPureSeedCatalog(localMenus)) {
            for (const menu of localMenus) {
              await syncMenu(menu);
            }
          }
        }

        // GAP-1 fix: Load custom categories from cloud
        const cloudCategories = await fetchCustomCategoriesFromCloud();
        if (cloudCategories !== null) {
          if (cloudCategories.length > 0) {
            set({ customCategories: cloudCategories });
          } else {
            // 28.1: konsisten — jangan push kategori seed bila katalog lokal seed murni
            const localCategories = get().customCategories;
            const localMenus = get().menus;
            if (!isPureSeedCatalog(localMenus)) {
              await syncCustomCategories(localCategories);
            }
          }
        }
        return true;
      },
    }),
    {
      name: 'rempah-menus',
      storage: createJSONStorage(() => safeStorage),
      // 28.3: persist deletedMenuIds bersama menus (tombstone lintas reload)
      partialize: (s) => ({ menus: s.menus, customCategories: s.customCategories, deletedMenuIds: s.deletedMenuIds }),
    }
  )
);
