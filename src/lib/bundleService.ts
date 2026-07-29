/**
 * Bundle Service — BerdikariPOS v4.0
 * 
 * Domain Service for:
 * 1. Generating Child Cart Items from a Parent Bundle Menu
 * 2. Scaling Child Cart Items when Bundle quantity changes
 * 3. Calculating Bundle COGS / HPP from Child Menu recipes
 * 4. Filtering items for Kitchen Printing, KDS, and Sales Reports
 */

import type {
  Menu,
  CartItem,
  MenuComponent,
  BundleComponentSnapshot,
  RecipeIngredientSnapshot,
  InventoryItem,
} from '../types';
import { calculateMenuHPP } from '../utils/hpp';

/**
 * Generate Child Cart Items linked to a Parent Bundle Cart Item.
 * Child items have basePrice = 0, subtotal = 0, and isBundleChild = true.
 */
export function createBundleChildCartItems(
  parentCartItem: CartItem,
  bundleMenu: Menu,
  allMenus: Menu[],
  inventory: InventoryItem[] = []
): CartItem[] {
  if (!bundleMenu.isBundle || !bundleMenu.components || bundleMenu.components.length === 0) {
    return [];
  }

  const childCartItems: CartItem[] = [];

  bundleMenu.components.forEach((comp, idx) => {
    if (comp.childType === 'Menu') {
      const childMenu = allMenus.find((m) => m.id === comp.childId);
      if (!childMenu) return;

      const totalQty = comp.quantity * parentCartItem.quantity;
      const childHpp = calculateMenuHPP(childMenu, inventory);

      // Build Recipe Snapshot for child item
      const recipeSnapshot: RecipeIngredientSnapshot[] = Object.entries(childMenu.ingredients).map(([invId, amount]) => {
        const invItem = inventory.find((i) => i.id === invId);
        const unitCost = invItem?.costPerUnit || 0;
        const qtyPerItem = amount * comp.quantity; // per 1 bundle unit
        const totalQtyNeeded = qtyPerItem * parentCartItem.quantity;
        return {
          inventoryId: invId,
          inventoryName: invItem?.name || invId,
          unit: invItem?.unit || 'pcs',
          qty: qtyPerItem,
          totalQty: totalQtyNeeded,
          unitCost,
          subtotalCost: totalQtyNeeded * unitCost,
          source: 'menu',
        };
      });

      const childLineId = `${parentCartItem.lineId}-child-${idx + 1}-${comp.childId}`;

      const childCartItem: CartItem = {
        lineId: childLineId,
        menuId: childMenu.id,
        name: childMenu.name,
        basePrice: 0, // Child item does NOT affect pricing
        quantity: totalQty,
        temperature: parentCartItem.temperature || 'Dingin',
        sugar: parentCartItem.sugar || 'Normal',
        addons: [],
        subtotal: 0, // Price is 0 for operational child items
        kitchenTarget: childMenu.kitchenTarget || 'Dapur',
        showSugarLevel: childMenu.showSugarLevel,
        showTemperature: childMenu.showTemperature,
        tableNumber: parentCartItem.tableNumber,
        isBundleChild: true,
        parentLineId: parentCartItem.lineId,
        recipeSnapshot,
        cogs: childHpp * totalQty,
        hpp: childHpp * totalQty,
      };

      childCartItems.push(childCartItem);
    }
  });

  return childCartItems;
}

/**
 * Calculate total HPP / COGS for a Bundle Menu by aggregating child menu HPPs.
 */
export function calculateBundleHPP(
  bundleMenu: Menu,
  allMenus: Menu[],
  inventory: InventoryItem[] = []
): number {
  if (bundleMenu.manualHpp && bundleMenu.manualHpp > 0) {
    return bundleMenu.manualHpp;
  }

  if (!bundleMenu.components || bundleMenu.components.length === 0) {
    return 0;
  }

  let totalHpp = 0;

  for (const comp of bundleMenu.components) {
    if (comp.childType === 'Menu') {
      const childMenu = allMenus.find((m) => m.id === comp.childId);
      if (childMenu) {
        const childHpp = calculateMenuHPP(childMenu, inventory);
        totalHpp += childHpp * comp.quantity;
      }
    } else if (comp.childType === 'Inventory') {
      const invItem = inventory.find((i) => i.id === comp.childId);
      if (invItem) {
        totalHpp += (invItem.costPerUnit || 0) * comp.quantity;
      }
    }
  }

  return totalHpp;
}

/**
 * Create immutable Bundle Component Snapshot for transactions.
 */
export function buildBundleComponentsSnapshot(
  bundleMenu: Menu,
  bundleQuantity: number,
  allMenus: Menu[],
  inventory: InventoryItem[] = []
): BundleComponentSnapshot[] {
  if (!bundleMenu.components) return [];

  return bundleMenu.components.map((comp) => {
    let childName = comp.childId;
    let kitchenTarget = 'Dapur';
    let ingredients: Record<string, number> = {};

    if (comp.childType === 'Menu') {
      const childMenu = allMenus.find((m) => m.id === comp.childId);
      if (childMenu) {
        childName = childMenu.name;
        kitchenTarget = childMenu.kitchenTarget || 'Dapur';
        ingredients = childMenu.ingredients || {};
      }
    } else if (comp.childType === 'Inventory') {
      const invItem = inventory.find((i) => i.id === comp.childId);
      if (invItem) {
        childName = invItem.name;
      }
    }

    const recipeSnapshot: RecipeIngredientSnapshot[] = Object.entries(ingredients).map(([invId, amount]) => {
      const invItem = inventory.find((i) => i.id === invId);
      const unitCost = invItem?.costPerUnit || 0;
      const qtyPerUnit = amount * comp.quantity;
      const totalQty = qtyPerUnit * bundleQuantity;
      return {
        inventoryId: invId,
        inventoryName: invItem?.name || invId,
        unit: invItem?.unit || 'pcs',
        qty: qtyPerUnit,
        totalQty,
        unitCost,
        subtotalCost: totalQty * unitCost,
        source: 'menu',
      };
    });

    return {
      componentId: comp.id,
      childType: comp.childType,
      childId: comp.childId,
      childName,
      quantity: comp.quantity,
      totalQuantity: comp.quantity * bundleQuantity,
      kitchenTarget,
      ingredients,
      recipeSnapshot,
    };
  });
}

/**
 * Filter items for Kitchen Printing & KDS.
 * Rules:
 * - Parent Bundles are NEVER sent/printed in Kitchen.
 * - Only Child Menu Items and Regular Menu Items are sent to Kitchen.
 */
export function filterItemsForKitchen(cartItems: CartItem[]): CartItem[] {
  return cartItems.filter((item) => !item.isBundle);
}

/**
 * Filter items for Sales Reports & Revenue Analytics.
 * Rules:
 * - Child Menu Items are operational only (price = 0) and must NOT distort Sales Reports or Revenue.
 * - Only Parent Bundles and Regular Menu Items are displayed in Sales Reports.
 */
export function filterItemsForSalesReport(cartItems: CartItem[]): CartItem[] {
  return cartItems.filter((item) => !item.isBundleChild);
}
