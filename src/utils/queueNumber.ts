import type { Transaction } from '../types';

// v4.7 TO DO 18.2/18.3 (Prioritas 18) — helper murni nomor antrean.

/**
 * Kunci tanggal LOKAL (YYYY-MM-DD) dari timestamp ISO.
 *
 * v4.7 TO DO 18.3 (fix): `t.date` disimpan sebagai ISO UTC (`new Date().toISOString()`),
 * sedangkan "hari ini" untuk nomor antrean memakai TANGGAL LOKAL device (getTodayDateStr /
 * counter queue_counters per tanggal lokal). Membandingkan `t.date.startsWith(todayStr)`
 * SALAH pada jam 00:00–07:00 WIB (UTC = tanggal sebelumnya) → transaksi pagi buta terlewat,
 * floor terlalu rendah, nomor antrean bisa menabrak #N yang sudah ada. Konversi eksplisit
 * ke tanggal lokal menyamakan kedua sisi. String non-parseable jatuh ke prefix ISO (legacy).
 */
export function toLocalDateKey(isoDate: string | undefined): string {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate.slice(0, 10);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Nomor antrean tertinggi yang sudah dipakai hari ini (lokal), mengecualikan Demo/Cancel —
 * konsisten dengan semantik getNextQueueNumber & fetchMaxQueueNumberCloud.
 * Dipakai sebagai FLOOR saat fallback lokal: nomor berikutnya = maxQueue + 1.
 */
export function localMaxQueueNumber(txs: Transaction[], todayStr: string): number {
  return txs
    .filter((t) => toLocalDateKey(t.date) === todayStr && t.txStatus !== 'Demo' && t.txStatus !== 'Cancel')
    .reduce((max, t) => Math.max(max, t.queueNumber || 0), 0);
}

/**
 * Deteksi nomor antrean DUPLIKAT dalam satu hari (dua transaksi ber-label sama, mis.
 * dua kasir offline memakai baseline yang sama). Demo/Cancel dikecualikan; nomor 0 diabaikan.
 * Pengelompokan memakai tanggal LOKAL (toLocalDateKey) — konsisten dengan reset harian nomor.
 * Mengembalikan Set nomor yang muncul > 1× pada tanggal yang sama.
 */
export function findDuplicateQueueNumbers(txs: Transaction[]): Set<number> {
  const perDay = new Map<string, Map<number, number>>();
  for (const t of txs) {
    if (t.txStatus === 'Demo' || t.txStatus === 'Cancel') continue;
    // v4.7 TO DO 18.8 (A7): sub-bill split berbagi SATU nomor antrean (1 pesanan = 1 nomor,
    // fresh & pending) — TIDAK dianggap duplikat (badge #N hanya untuk nomor kembar antar
    // pesanan berbeda, mis. dua kasir offline memakai baseline yang sama).
    if (t.splitParentId || t.splitIndex !== undefined) continue;
    const day = toLocalDateKey(t.date);
    const num = t.queueNumber || 0;
    if (num <= 0) continue;
    let counts = perDay.get(day);
    if (!counts) {
      counts = new Map();
      perDay.set(day, counts);
    }
    counts.set(num, (counts.get(num) || 0) + 1);
  }
  const dups = new Set<number>();
  for (const counts of perDay.values()) {
    for (const [num, c] of counts) {
      if (c > 1) dups.add(num);
    }
  }
  return dups;
}
