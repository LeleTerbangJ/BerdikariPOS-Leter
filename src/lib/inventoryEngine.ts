import type { CartItem, Menu, InventoryItem } from '../types';
import { calculateItemDeductions } from '../utils/hpp';

export interface InventoryValidationResult {
  valid: boolean;
  warnings: {
    ingredientId: string;
    ingredientName: string;
    required: number;
    available: number;
    unit: string;
    // v4.7 TO DO 18.8 (A11): true bila bahan yang direferensikan resep TIDAK ADA lagi di
    // inventory (id sudah dihapus) — sebelumnya dilewati diam-diam tanpa peringatan apa pun.
    missing?: boolean;
  }[];
}

/**
 * INVENTORY ENGINE: Enterprise-Grade Inventory Domain Logic
 * Principles: Single Responsibility, Immutable Validation, Pre-flight Checks
 */
export class InventoryEngine {
  /**
   * Pre-flight stock availability check.
   * Ensures ALL required ingredients (including menu + add-ons) have sufficient stock.
   */
  static validateStockAvailability(
    cartItems: CartItem[],
    menus: Menu[],
    inventory: InventoryItem[]
  ): InventoryValidationResult {
    const required = calculateItemDeductions(cartItems, menus);
    const warnings: InventoryValidationResult['warnings'] = [];

    for (const [invId, needed] of Object.entries(required)) {
      const inv = inventory.find((i) => i.id === invId);
      // v4.7 TO DO 18.8 (A11): bahan yang direferensikan resep sudah DIHAPUS dari inventory —
      // jangan dilewati diam-diam. Laporkan sebagai warning (stok tidak bisa diverifikasi;
      // deduksi untuk id ini juga tidak akan terjadi). Kasir bisa lanjut via "Lanjutkan Tetap".
      if (!inv) {
        warnings.push({
          ingredientId: invId,
          ingredientName: invId,
          required: needed,
          available: 0,
          unit: '',
          missing: true,
        });
        continue;
      }
      if (inv.stock < needed) {
        warnings.push({
          ingredientId: invId,
          ingredientName: inv.name,
          required: needed,
          available: inv.stock,
          unit: inv.unit,
        });
      }
    }

    return {
      valid: warnings.length === 0,
      warnings,
    };
  }

  /**
   * Compute exact item deductions for cart items & menus.
   */
  static computeDeductions(cartItems: CartItem[], menus: Menu[]): Record<string, number> {
    return calculateItemDeductions(cartItems, menus);
  }

  /**
   * Capture an immutable snapshot of current inventory items before mutation.
   */
  static captureSnapshot(inventory: InventoryItem[]): Map<string, number> {
    const snapshot = new Map<string, number>();
    for (const item of inventory) {
      snapshot.set(item.id, item.stock);
    }
    return snapshot;
  }
}
