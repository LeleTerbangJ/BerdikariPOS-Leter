/**
 * Stock Import & Opname Helpers — v4.7 (TO DO 9.1 & 9.2)
 *
 * Logika murni untuk:
 * - 9.1: merencanakan entri stock log tipe 'import' saat CSV import (item existing vs baru).
 * - 9.2: mendeteksi item opname yang stoknya berubah di perangkat lain sejak form dibuka
 *        (race lintas device → lost update bila menulis stok absolut tanpa konfirmasi).
 * - 10.4: clamp stok aktual opname (negatif/NaN → 0).
 */

import type { InventoryItem, StockOpnameItem } from '../types';
import type { StockLogEntry } from '../store/stockLogStore';

export interface ParsedImportRow {
  id: string;
  name: string;
  stock: number;
  unit: string;
  costPerUnit: number;
  minStock: number;
}

export interface CsvImportPlan {
  action: 'update' | 'create';
  /** Entri stock log tipe 'import' yang harus dicatat (undefined bila stok tidak berubah). */
  log?: Omit<StockLogEntry, 'id' | 'date'>;
}

/**
 * TO DO 9.1 — rencanakan aksi + log 'import' untuk satu baris CSV.
 * - Item existing dengan stok berubah → update + log 'import' (bukan 'adjust' generik).
 * - Item existing dengan stok sama → update tanpa log (tidak ada perubahan stok).
 * - Item BARU → create + log 'import' dengan stok awal (stockBefore 0).
 */
export function planCsvImportRow(
  existing: InventoryItem | undefined,
  parsed: ParsedImportRow
): CsvImportPlan {
  if (existing) {
    const stockChanged = existing.stock !== parsed.stock;
    return {
      action: 'update',
      log: stockChanged
        ? {
            inventoryId: parsed.id,
            inventoryName: parsed.name,
            type: 'import',
            amount: parsed.stock - existing.stock,
            stockBefore: existing.stock,
            stockAfter: parsed.stock,
            unit: parsed.unit,
            reason: 'Import CSV',
          }
        : undefined,
    };
  }
  return {
    action: 'create',
    log: {
      inventoryId: parsed.id,
      inventoryName: parsed.name,
      type: 'import',
      amount: parsed.stock,
      stockBefore: 0,
      stockAfter: parsed.stock,
      unit: parsed.unit,
      reason: 'Import CSV',
    },
  };
}

// ============================================================
// TO DO 9.2 — deteksi drift stok opname (race lintas device)
// ============================================================

/** Item opname yang akan DITULIS ke inventory (difference != 0). */
export interface OpnameWriteItem {
  inventoryId: string;
  inventoryName: string;
  unit: string;
  /** Stok sistem saat form DIBUKA (snapshot). */
  systemStock: number;
  /** Selisih terhadap snapshot (actual - systemStock). */
  difference: number;
}

export interface StockDrift {
  inventoryId: string;
  name: string;
  unit: string;
  systemStock: number;
  currentStock: number;
}

/**
 * Item opname yang stoknya BERUBAH di perangkat lain sejak form dibuka
 * (currentStock ≠ systemStock snapshot). Hanya item yang akan ditulis
 * (difference != 0) yang diperiksa. Mengembalikan daftar drift untuk konfirmasi.
 */
export function findDriftedOpnameItems(
  opnameItems: OpnameWriteItem[],
  inventory: InventoryItem[]
): StockDrift[] {
  return opnameItems
    .filter((i) => i.difference !== 0)
    .map((i) => {
      const current = inventory.find((x) => x.id === i.inventoryId);
      return { item: i, currentStock: current?.stock ?? i.systemStock };
    })
    .filter(({ item, currentStock }) => Math.abs(currentStock - item.systemStock) > 1e-9)
    .map(({ item, currentStock }) => ({
      inventoryId: item.inventoryId,
      name: item.inventoryName,
      unit: item.unit,
      systemStock: item.systemStock,
      currentStock,
    }));
}

// ============================================================
// TO DO 10.1 — mode blind: tutup oracle ±10% (Staf Gudang)
// ============================================================

/**
 * Jalur konfirmasi yang dipakai saat submit opname.
 * TO DO 10.1: untuk Staf Gudang (blind mode) SELALU jalur PIN — tanpa banner selisih dan tanpa
 * ConfirmDialog terpisah, sehingga tidak ada sinyal diferensial yang membocorkan ambang ±10%
 * (oracle yang memungkinkan membaca stok sistem via trial-and-error).
 */
export function resolveOpnameGate(
  isWarehouseStaff: boolean,
  hasLargeDifference: boolean
): 'pin' | 'confirm' {
  return isWarehouseStaff || hasLargeDifference ? 'pin' : 'confirm';
}

/** Banner "Selisih Besar Terdeteksi" HANYA untuk non-staff (staff blind — jangan bocor). */
export function shouldShowLargeDifferenceBanner(
  isWarehouseStaff: boolean,
  hasLargeDifference: boolean
): boolean {
  return !isWarehouseStaff && hasLargeDifference;
}

// ============================================================
// TO DO 10.4 — clamp stok aktual opname (negatif/NaN tidak masuk inventory)
// ============================================================

/**
 * TO DO 10.4 — parse aman input "Stok Fisik" opname.
 * - negatif (mis. "-5") → 0 (clamp) — sebelumnya `parseFloat("-5") = -5` langsung ditulis ke inventory.
 * - NaN / kosong / teks → 0 (fallback `|| 0`).
 * Nilai inilah SATU-SATUNYA yang dipakai untuk menulis stok (`applyBulkStock`).
 */
export function parseActualStock(raw: string): number {
  return Math.max(0, parseFloat(raw) || 0);
}

// ============================================================
// TO DO 10.3 — alasan penyesuaian wajib (Staf Gudang, pasca-PIN)
// ============================================================

/**
 * Terapkan SATU alasan utama (pilihan pasca-PIN, TO DO 10.3) ke item berselisih yang belum
 * punya alasan. Staf Gudang di mode buta tidak tahu item mana yang berselisih — mewajibkan
 * alasan per-item tidak praktis, jadi alasan opname-level diisi ke item yang difference != 0
 * dan reason-nya kosong/'-'. Item yang sudah punya alasan tidak ditimpa.
 */
export function fillMissingItemReasons(
  items: StockOpnameItem[],
  reason: string
): StockOpnameItem[] {
  if (!reason) return items;
  return items.map((i) =>
    i.difference !== 0 && (!i.reason || i.reason === '-')
      ? { ...i, reason }
      : i
  );
}
