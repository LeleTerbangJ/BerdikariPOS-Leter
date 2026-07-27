import type { InventoryItem, Menu, CartItem, RecipeIngredientSnapshot } from '../types';

/**
 * Menghitung HPP (Harga Pokok Penjualan) sebuah menu
 * berdasarkan komposisi bahan baku dan costPerUnit inventory.
 */
export const calculateMenuHPP = (
  menu: Menu,
  inventory: InventoryItem[]
): number => {
  if (!menu.ingredients || Object.keys(menu.ingredients).length === 0) {
    return menu.manualHpp || 0;
  }
  let total = 0;
  for (const [invId, amount] of Object.entries(menu.ingredients)) {
    const inv = inventory.find((i) => i.id === invId);
    if (inv) total += inv.costPerUnit * amount;
  }
  return total;
};

/**
 * Membuat Recipe Snapshot (Bill of Materials/BOM) permanen untuk satu CartItem
 * pada saat checkout transaksi. Menyimpan detail bahan, quantity, unit cost, dan subtotal cost.
 */
export const buildItemRecipeSnapshot = (
  item: CartItem,
  menu: Menu | undefined,
  inventory: InventoryItem[]
): RecipeIngredientSnapshot[] => {
  const snapshots: RecipeIngredientSnapshot[] = [];

  // 1. Bahan baku menu utama
  if (menu && menu.ingredients && Object.keys(menu.ingredients).length > 0) {
    for (const [invId, amount] of Object.entries(menu.ingredients)) {
      const inv = inventory.find((i) => i.id === invId);
      const unitCost = inv?.costPerUnit || 0;
      const totalQty = amount * item.quantity;
      snapshots.push({
        inventoryId: invId,
        inventoryName: inv?.name || invId,
        unit: inv?.unit || 'unit',
        qty: amount,
        totalQty,
        unitCost,
        subtotalCost: totalQty * unitCost,
        source: 'menu',
      });
    }
  } else if (menu && menu.manualHpp && menu.manualHpp > 0) {
    // Fallback jika menu menggunakan HPP Manual tanpa rincian bahan baku
    snapshots.push({
      inventoryId: `manual_${menu.id}`,
      inventoryName: `HPP Manual (${item.name})`,
      unit: 'pcs',
      qty: 1,
      totalQty: item.quantity,
      unitCost: menu.manualHpp,
      subtotalCost: item.quantity * menu.manualHpp,
      source: 'menu',
    });
  }

  // 2. Bahan baku dari Addons yang dipilih
  for (const addon of item.addons) {
    let addonIngredients = addon.ingredients;
    if (!addonIngredients && menu) {
      const matchedAddon = menu.availableAddons?.find((a) => a.name === addon.name);
      if (matchedAddon?.ingredients) {
        addonIngredients = matchedAddon.ingredients;
      }
    }

    if (addonIngredients && Object.keys(addonIngredients).length > 0) {
      for (const [invId, amount] of Object.entries(addonIngredients)) {
        const inv = inventory.find((i) => i.id === invId);
        const unitCost = inv?.costPerUnit || 0;
        const totalQty = amount * item.quantity;
        snapshots.push({
          inventoryId: invId,
          inventoryName: `${inv?.name || invId} (Addon ${addon.name})`,
          unit: inv?.unit || 'unit',
          qty: amount,
          totalQty,
          unitCost,
          subtotalCost: totalQty * unitCost,
          source: 'addon',
          addonName: addon.name,
        });
      }
    } else if (addon.hpp && addon.hpp > 0) {
      snapshots.push({
        inventoryId: `manual_addon_${addon.name}`,
        inventoryName: `HPP Addon (${addon.name})`,
        unit: 'pcs',
        qty: 1,
        totalQty: item.quantity,
        unitCost: addon.hpp,
        subtotalCost: item.quantity * addon.hpp,
        source: 'addon',
        addonName: addon.name,
      });
    }
  }

  return snapshots;
};

/**
 * Menghitung total HPP dari recipe snapshot sebuah item
 */
export const calculateItemSnapshotHPP = (
  recipeSnapshot: RecipeIngredientSnapshot[]
): number => {
  return recipeSnapshot.reduce((acc, ing) => acc + ing.subtotalCost, 0);
};

/**
 * Membuat snapshot recipe & HPP untuk seluruh cart item pada saat checkout
 */
export const createSnapshotForCartItems = (
  items: CartItem[],
  menus: Menu[],
  inventory: InventoryItem[]
): { itemsWithSnapshot: CartItem[]; totalHpp: number } => {
  let totalHpp = 0;
  const itemsWithSnapshot: CartItem[] = items.map((item) => {
    const menu = menus.find((m) => m.id === item.menuId);
    const recipeSnapshot = buildItemRecipeSnapshot(item, menu, inventory);
    const itemHpp = calculateItemSnapshotHPP(recipeSnapshot);
    totalHpp += itemHpp;
    return {
      ...item,
      recipeSnapshot,
      cogs: itemHpp,
      hpp: itemHpp,
    };
  });

  return { itemsWithSnapshot, totalHpp };
};

/**
 * Menghitung total HPP untuk seluruh cart item pada transaksi
 */
export const calculateTransactionHPP = (
  items: CartItem[],
  menus: Menu[],
  inventory: InventoryItem[]
): number => {
  let total = 0;
  for (const item of items) {
    if (item.hpp !== undefined) {
      total += item.hpp;
    } else {
      const menu = menus.find((m) => m.id === item.menuId);
      if (menu) {
        total += calculateMenuHPP(menu, inventory) * item.quantity;
      }
      for (const addon of item.addons) {
        if (addon.hpp && addon.hpp > 0) {
          total += addon.hpp * item.quantity;
        }
      }
    }
  }
  return total;
};

/**
 * Menghitung total kebutuhan bahan baku (deduksi stok) dari transaksi.
 * Jika item memiliki recipeSnapshot, gunakan snapshot. Jika tidak (transaksi lama), fallback.
 */
export const calculateItemDeductions = (
  items: CartItem[],
  menus: Menu[]
): Record<string, number> => {
  const deductions: Record<string, number> = {};
  let hasSnapshot = false;

  for (const item of items) {
    if (item.recipeSnapshot && item.recipeSnapshot.length > 0) {
      hasSnapshot = true;
      for (const ing of item.recipeSnapshot) {
        if (ing.inventoryId && !ing.inventoryId.startsWith('manual_')) {
          deductions[ing.inventoryId] = (deductions[ing.inventoryId] || 0) + ing.totalQty;
        }
      }
    }
  }

  if (hasSnapshot) {
    return deductions;
  }

  // Fallback untuk transaksi lama sebelum fitur snapshot recipe
  for (const item of items) {
    const menu = menus.find((m) => m.id === item.menuId);
    if (menu && menu.ingredients) {
      for (const [invId, amount] of Object.entries(menu.ingredients)) {
        deductions[invId] = (deductions[invId] || 0) + amount * item.quantity;
      }
    }
    for (const addon of item.addons) {
      if (addon.ingredients) {
        for (const [invId, amount] of Object.entries(addon.ingredients)) {
          deductions[invId] = (deductions[invId] || 0) + amount * item.quantity;
        }
      } else if (menu) {
        const matchedAddon = menu.availableAddons?.find((a) => a.name === addon.name);
        if (matchedAddon?.ingredients) {
          for (const [invId, amount] of Object.entries(matchedAddon.ingredients)) {
            deductions[invId] = (deductions[invId] || 0) + amount * item.quantity;
          }
        }
      }
    }
  }

  return deductions;
};
