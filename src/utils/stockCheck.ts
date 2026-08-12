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

// ============================================================
// TO DO 8.4 — PANTUAN stok negatif PASCA-deduksi (bukan blokir)
// ============================================================

/** Item yang menjadi NEGATIF setelah deduksi diterapkan (race lintas device bisa sebabkan ini). */
export interface NegativeStockAlert {
  inventoryId: string;
  name: string;
  /** Stok setelah deduksi (bernilai negatif). */
  stock: number;
  unit: string;
}

/**
 * Hitung item yang stoknya jatuh di bawah 0 oleh `deductions` (berdasarkan stok SAAT INI).
 * Murni & deterministik — tidak mengubah state apa pun.
 *
 * Catatan: validasi stok hanya pre-flight (LOGIC-5 izinkan negatif). Dua device yang
 * checkout bahan terakhir bersamaan bisa menghasilkan stok negatif — ini dideteksi di sini
 * agar UI bisa memberi peringatan (bukan memblokir kasir).
 */
export function findNegativeStocksAfterDeduction(
  items: InventoryItem[],
  deductions: Record<string, number>
): NegativeStockAlert[] {
  const alerts: NegativeStockAlert[] = [];
  for (const [id, amount] of Object.entries(deductions)) {
    if (!amount) continue;
    const item = items.find((i) => i.id === id);
    if (!item) continue;
    const after = item.stock - amount;
    if (after < 0) {
      alerts.push({ inventoryId: id, name: item.name, stock: after, unit: item.unit });
    }
  }
  return alerts;
}
