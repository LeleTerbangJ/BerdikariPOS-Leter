import type { InventoryItem } from '../types';

/**
 * v4.7 TO DO 13.5 (O-7) — Deteksi konflik stok lintas device saat sync.
 *
 * Skenario: dua device menjual bahan yang sama saat offline → keduanya memotong stok
 * lokal → sync memakai last-write-wins → salah satu deduksi tertimpa dan stok sistem
 * "naik" kembali (lebih tinggi dari kenyataan fisik). Perbaikan penuh (merge berbasis
 * updated_at / op-log) adalah pekerjaan besar; langkah ini memberi VISIBILITAS:
 * saat merge cloud terjadi, item yang stoknya NAIK relatif terhadap nilai lokal kita
 * ditandai sebagai potensi konflik agar staf memeriksa stok fisik.
 *
 * - `diff > 0` (cloud > lokal): bisa berarti (a) deduksi device ini tertimpa device lain
 *   (konflik), atau (b) penambahan stok dari device lain (adjustment/opname). Dua-duanya
 *   layak diperiksa → dibunyikan.
 * - `diff <= 0` (cloud <= lokal): normal (device lain menjual lebih dulu / nilai sama) —
 *   TIDAK dibunyikan agar tidak bising.
 * - Perubahan ≤ 0.01 diabaikan (rounding float).
 */
export interface StockConflict {
  ingredientId: string;
  name: string;
  unit: string;
  localBefore: number; // stok lokal sebelum merge (yang kita lihat)
  cloudNow: number;    // stok dari cloud setelah merge
  diff: number;        // cloudNow - localBefore (positif = stok "naik")
}

export function detectStockConflicts(
  localBefore: Map<string, InventoryItem>,
  cloudItems: InventoryItem[]
): StockConflict[] {
  const conflicts: StockConflict[] = [];
  for (const cloud of cloudItems) {
    const local = localBefore.get(cloud.id);
    if (!local) continue; // item baru dari cloud — bukan konflik
    const localStock = local.stock ?? 0;
    const cloudStock = cloud.stock ?? 0;
    const diff = cloudStock - localStock;
    if (diff > 0.01) {
      conflicts.push({
        ingredientId: cloud.id,
        name: cloud.name,
        unit: cloud.unit,
        localBefore: localStock,
        cloudNow: cloudStock,
        diff,
      });
    }
  }
  return conflicts.sort((a, b) => b.diff - a.diff);
}
