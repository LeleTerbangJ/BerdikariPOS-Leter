import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import type { Menu, MenuComponent, ComponentType, ComponentMode } from '../types';
import { seedMenus } from '../utils/seed';
import { syncMenu, deleteMenuCloud, fetchMenusFromCloud, syncCustomCategories, fetchCustomCategoriesFromCloud } from '../lib/cloudSync';
import { fetchComponentsFromCloud, syncComponentToCloud, deleteComponentFromCloud } from '../lib/bundleRepository';
import { useAuditLogStore } from './auditLogStore';
import { useAuthStore } from './authStore';

interface MenuState {
  menus: Menu[];
  menuComponents: MenuComponent[];
  customCategories: string[];
  addMenu: (menu: Menu) => void;
  updateMenu: (id: string, data: Partial<Menu>) => void;
  deleteMenu: (id: string) => void;
  importMenus: (menus: Menu[]) => void;
  getCategories: () => string[];
  addCategory: (cat: string) => void;
  deleteCategory: (cat: string) => void;
  addComponent: (component: MenuComponent) => void;
  updateComponent: (id: string, data: Partial<MenuComponent>) => void;
  deleteComponent: (id: string) => void;
  getComponentsByParent: (parentMenuId: string) => MenuComponent[];
  loadFromCloud: (fullSync?: boolean) => Promise<void>;
}

export const useMenuStore = create<MenuState>()(
  persist(
    (set, get) => ({
      menus: seedMenus,
      menuComponents: [],
      customCategories: ['Jamu Murni', 'Wedang', 'Signature', 'Segar', 'Paket Combo'],

      addMenu: (menu) => {
        set((s) => ({ menus: [...s.menus, menu] }));
        syncMenu(menu);
      },

      updateMenu: (id, data) => {
        set((s) => ({
          menus: s.menus.map((m) => (m.id === id ? { ...m, ...data } : m)),
        }));
        const updatedMenu = get().menus.find((m) => m.id === id);
        if (updatedMenu) syncMenu(updatedMenu);
      },

      deleteMenu: (id) => {
        deleteMenuCloud(id);
        set((s) => ({ menus: s.menus.filter((m) => m.id !== id) }));
      },

      importMenus: (menus) => {
        set({ menus });
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

        if (cloudMenus !== null) {
          if (cloudMenus.length > 0) {
            set((s) => {
              const cloudIds = new Set(cloudMenus.map((m) => m.id));
              let localOnly: Menu[];
              if (fullSync) {
                localOnly = [];
              } else {
                localOnly = s.menus.filter((m) => !cloudIds.has(m.id));
              }
              const componentsList = cloudComponents !== null ? cloudComponents : s.menuComponents;
              const mergedMenus = cloudMenus.map((cm) => {
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
              return {
                menus: [...mergedMenus, ...localOnly],
                menuComponents: componentsList,
              };
            });
          } else {
            const localMenus = get().menus;
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
            const localCategories = get().customCategories;
            await syncCustomCategories(localCategories);
          }
        }
      },
    }),
    { name: 'rempah-menus', storage: createJSONStorage(() => safeStorage) }
  )
);
