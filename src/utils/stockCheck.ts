import { InventoryEngine, type InventoryValidationResult } from '../lib/inventoryEngine';
import type { CartItem, Menu, InventoryItem } from '../types';

/**
 * v4.1 TO DO 2.5 — UNIFIKASI VALIDASI STOK.
 *
 * File ini kini hanya compat-shim: logika validasi stok TIDAK diduplikasi lagi.
 * Satu-satunya sumber kebenaran adalah `InventoryEngine.validateStockAvailability`
 * (dipakai juga oleh AtomicTransactionEngine & SplitBillModal).
 *
 * Fungsi `checkStockAvailability` dipertahankan sebagai alias agar pemanggil lama
 * (POS.tsx) tidak perlu diubah — signature & hasil 100% identik.
 *
 * @deprecated Gunakan `InventoryEngine.validateStockAvailability(...).warnings` untuk kode baru.
 */
// Tipe diturunkan dari engine agar satu sumber kebenaran di level tipe juga
// (perubahan field di engine tidak bisa divergen dari shim ini).
export type StockWarning = InventoryValidationResult['warnings'][number];

export function checkStockAvailability(
  cartItems: CartItem[],
  menus: Menu[],
  inventory: InventoryItem[]
): StockWarning[] {
  return InventoryEngine.validateStockAvailability(cartItems, menus, inventory).warnings;
}
