import type { Transaction } from '../types';

/**
 * v4.5 TO DO 6.1 — Prune data sebelum dipersist ke localStorage agar
 * payload tidak melebihi kuota (error berantai: save pending gagal,
 * ghost transaction, deadlock tutup shift).
 *
 * Modul murni (tanpa store/side-effect) agar mudah diuji unit.
 */

export const DEFAULT_TRANSACTION_KEEP = 300; // maksimum transaksi tersimpan lokal
export const DEFAULT_TRANSACTION_TTL_DAYS = 90; // jendela waktu transaksi tersimpan lokal
export const DEFAULT_AUDIT_LOG_CAP = 2000; // cap audit log lokal
export const DEFAULT_STOCK_LOG_CAP = 500; // cap stock log lokal
// v4.7 TO DO 13.12 (O-8): cap tombstone transaksi — store transaksi sudah IndexedDB
// (kuota besar), jadi cap dinaikkan 200 → 1000 (anti ghost saat > 200 penghapusan
// offline sebelum konfirmasi cloud); pruneConfirmedTombstones tetap membersihkan
// yang sudah terkonfirmasi di tiap loadFromCloud.
export const DEFAULT_TOMBSTONE_CAP = 1000;

const isPendingTx = (t: Transaction): boolean =>
  t.txStatus === 'Pending' || t.isPending === true;

/**
 * Prune transaksi untuk persist lokal (payload TERBATAS = maxCount + pending):
 * - Sortir descending (terbaru dulu)
 * - Ambil jendela TTL (default 90 hari) bila lebih kecil dari maxCount; selain itu ambil maxCount terbaru
 * - Transaksi Pending SELALU dipertahankan walau di luar batas (pesanan gantung tidak boleh hilang)
 *
 * Trade-off: data di luar batas hanya hilang dari CACHE lokal — cloud tetap menyimpannya
 * dan `loadFromCloud` (fetch 500 terbaru) akan mengembalikannya saat aplikasi dibuka.
 */
export function pruneTransactionsForStorage(
  transactions: Transaction[],
  now: number = Date.now(),
  maxCount: number = DEFAULT_TRANSACTION_KEEP,
  ttlDays: number = DEFAULT_TRANSACTION_TTL_DAYS
): Transaction[] {
  const cutoff = now - ttlDays * 24 * 60 * 60 * 1000;

  // PRASYARAT: `transactions` sudah terurut descending (terbaru dulu) — invariant store:
  // addTransaction men-prepend, loadFromCloud menyortir desc. Kita TIDAK sort ulang di sini
  // karena partialize berjalan di SETIAP set() (termasuk updateKitchenStatus dari KDS) —
  // sort O(n log n) per tulis terasa di perangkat low-end yang persis terkena masalah kuota.
  // Satu pass, O(n), tanpa alokasi besar.
  const windowArr: Transaction[] = []; // dalam jendela TTL
  const topArr: Transaction[] = []; // maxCount terbaru
  const pendingArr: Transaction[] = []; // pending selalu dipertahankan

  for (const t of transactions) {
    if (new Date(t.date).getTime() >= cutoff) windowArr.push(t);
    if (topArr.length < maxCount) topArr.push(t);
    if (isPendingTx(t)) pendingArr.push(t);
  }

  // Ambil jendela TTL bila lebih kecil dari maxCount, selain itu maxCount terbaru
  const base = windowArr.length <= maxCount ? windowArr : topArr;

  // Dedupe base (aman jika store punya ID ganda hasil merge) + sisipkan pending di luar base
  const baseMap = new Map<string, Transaction>();
  base.forEach((t) => baseMap.set(t.id, t));
  const extraPending = pendingArr.filter((t) => !baseMap.has(t.id));

  return [...baseMap.values(), ...extraPending];
}

/**
 * Cap array (audit log / stock log) ke maxCount entri terbaru.
 */
export function capEntries<T>(entries: T[], maxCount: number): T[] {
  return entries.slice(0, maxCount);
}

/**
 * v4.5 TO DO 6.5 — Saring transaksi cloud yang id-nya di-tombstone (dihapus/rollback lokal)
 * agar tidak re-hidrasi (ghost).
 */
export function filterTombstoned<T extends { id: string }>(
  entries: T[],
  tombstonedIds: string[]
): T[] {
  const set = new Set(tombstonedIds);
  return entries.filter((t) => !set.has(t.id));
}

/**
 * v4.5 TO DO 6.5 — Pertahankan tombstone HANYA jika id-nya MASIH ada di cloud
 * (penghapusan cloud belum dikonfirmasi); id yang sudah tidak ada → buang tombstone.
 */
export function pruneConfirmedTombstones(
  tombstonedIds: string[],
  cloudIds: Iterable<string>
): string[] {
  const cloudSet = new Set(cloudIds);
  return tombstonedIds.filter((id) => cloudSet.has(id));
}
