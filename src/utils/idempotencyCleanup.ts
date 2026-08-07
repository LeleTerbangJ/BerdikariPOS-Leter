import type { Transaction, TransactionLifecycleState } from '../types';

export interface ProcessedRegistryEntry {
  state: TransactionLifecycleState;
  transaction?: Transaction;
  timestamp: string;
}

// v4.1 TO DO 2.4 — TTL & batas ukuran idempotency registry.
// Entry transaksi lama tidak lagi dibutuhkan untuk proteksi double-submit
// (transaksi 'Selesai' lama tidak akan di-resume), sehingga aman dibersihkan.
// Trade-off: setelah > TTL, anti-double-pay guard (txStatus 'Selesai' → tolak replay)
// tidak berlaku lagi untuk entry yang sudah dihapus — praktis tak terjangkau karena
// double-submit terjadi dalam hitungan milidetik.
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam
export const MAX_IDEMPOTENCY_ENTRIES = 1000;

/**
 * Bersihkan registry: buang entry berumur > ttlMs, lalu bila masih melebihi maxSize
 * buang entry tertua (berdasarkan timestamp). Fungsi murni agar mudah diuji unit
 * tanpa menarik dependensi store/engine.
 */
export function pruneIdempotencyEntries(
  entries: Map<string, ProcessedRegistryEntry>,
  now: number,
  ttlMs: number = IDEMPOTENCY_TTL_MS,
  maxSize: number = MAX_IDEMPOTENCY_ENTRIES
): void {
  for (const [id, entry] of entries) {
    if (now - new Date(entry.timestamp).getTime() > ttlMs) {
      entries.delete(id);
    }
  }
  if (entries.size > maxSize) {
    const sorted = [...entries.entries()].sort(
      (a, b) => new Date(a[1].timestamp).getTime() - new Date(b[1].timestamp).getTime()
    );
    const excess = entries.size - maxSize;
    for (let i = 0; i < excess; i++) {
      entries.delete(sorted[i][0]);
    }
  }
}
