import type { InventoryItem } from '../types';

/**
 * v4.7 TO DO 18.8 (A5) — Perbandingan freshness inventory (last-write-wins lintas device).
 *
 * Konteks: sync stok burst multi-device — `syncInventoryStock` mengirim nilai pasca-mutasi
 * lokal; urutan network dua device bisa tertukar → cloud bisa berakhir stale lebih tinggi,
 * lalu fetch berikutnya (loadFromCloud inventory) menimpa lokal dengan nilai stale itu.
 * Dengan membandingkan `updatedAt` per item, mutasi lokal yang BELUM tersinkron tidak akan
 * ditimpa fetch cloud stale (dan sebaliknya, cloud yang lebih baru diadopsi).
 *
 * Aturan:
 * - local tidak ada (item murni cloud) → false (cloud menang).
 * - cloud tidak ada → true (item lokal tidak boleh dianggap stale).
 * - keduanya punya updatedAt → yang timestamp-nya lebih besar menang.
 * - hanya satu yang punya updatedAt (data legacy) → yang ber-timestamp menang.
 * - keduanya tanpa updatedAt (legacy murni) → false (cloud menang — perilaku lama).
 */
export function isLocalNewer(
  local: InventoryItem | null | undefined,
  cloud?: InventoryItem | null
): boolean {
  if (!local) return false;
  if (!cloud) return true;
  const l = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
  const c = cloud.updatedAt ? new Date(cloud.updatedAt).getTime() : 0;
  return l > c;
}
