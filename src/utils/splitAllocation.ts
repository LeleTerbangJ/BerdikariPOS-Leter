import type { CartItem, Transaction } from '../types';

/**
 * v4.1 TO DO 2.2 — Alokasi proporsional dengan metode sisa terbesar (Largest Remainder Method).
 *
 * Menjamin Σ hasil === total induk TANPA selisih pembulatan rupiah:
 * contoh 100.000 dibagi rata 3 → 33.333, 33.333, 33.334 (total tetap 100.000).
 *
 * Modul murni (tanpa React/store) agar mudah diuji unit.
 */
export function allocateProportional(total: number, ratios: number[]): number[] {
  if (total <= 0 || ratios.length === 0) return ratios.map(() => 0);

  const raw = ratios.map((r) => total * r);
  const floored = raw.map((v) => Math.floor(v));
  const remainder = total - floored.reduce((a, b) => a + b, 0);
  const result = [...floored];

  // Distribusikan sisa rupiah ke elemen dengan fraksi terbesar (descending)
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .filter((x) => x.frac > 0)
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder && k < order.length; k++) {
    result[order[k].i] += 1;
  }

  // Hardening: jika sisa belum habis terdistribusi (misal semua ratio = 0),
  // tumpahkan ke indeks pertama agar Σ hasil === total tetap berlaku.
  if (remainder > order.length) {
    result[0] += remainder - order.length;
  }

  return result;
}

/**
 * v4.1 TO DO 2.3 — Transformasi struk sub-bill mode Equal (Split Nominal Rata):
 * setiap sub-bill membawa SEMUA item dengan subtotal penuh, padahal total = 1/N
 * → daftar item tidak konsisten dengan total bagian.
 *
 * Deteksi: Σ subtotal item ≠ subtotal sub-bill (mode item selalu Σ item = subtotal bill).
 * Kembalikan label bagian + daftar item dengan subtotal proporsional (Σ item === subtotal
 * bagian, tanpa selisih rupiah), atau `null` jika bukan mode equal / tidak bisa diskalakan.
 */
/**
 * v4.5 TO DO 5.11 — Deteksi sub-bill hasil SPLIT EQUAL (Split Nominal Rata).
 *
 * Sub-bill mode Equal membawa SEMUA item cart (subtotal item penuh), sementara
 * subtotal transaksinya = bagian 1/N → Σ item.subtotal ≠ subtotal sub-bill.
 * Sebaliknya, mode Item memindahkan item secara disjoint → Σ item.subtotal === subtotal bill.
 *
 * Dipakai laporan untuk membagi kontribusi per-menu (qty/revenue/hpp) dengan
 * `totalSplitCount` agar profitabilitas menu/kategori tidak ter-inflasi N×.
 */
export function isEqualSplitSubBill(tx: {
  splitIndex?: number;
  totalSplitCount?: number;
  subtotal: number;
  items: Array<{ subtotal: number }>;
}): boolean {
  if (!tx.splitIndex || !tx.totalSplitCount || tx.totalSplitCount < 2) return false;
  const itemsTotal = tx.items.reduce((a, i) => a + i.subtotal, 0);
  // Selisih >= Rp 1 (integer-safe): mode item selalu Σ item === subtotal persis.
  // Mencakup edge kasir kecil (subtotal 2 dibagi 2 → share 1, selisih 1).
  // ⚠️ Residual patologis (didokumentasikan, bukan blocker): tagihan Rp 1 dibagi 2 → alokasi
  // [1, 0]; sub-bill bershare 0 terdeteksi equal (divisor 2), yang bershare 1 tidak (selisih 0,
  // tak bisa dibedakan dari mode item) → agregasi bisa over-count 0.5 rupiah. Hanya terjadi
  // pada transaksi Rp 1 — dapat diabaikan untuk tujuan pelaporan.
  return Math.abs(itemsTotal - tx.subtotal) >= 1;
}

/**
 * v4.5 TO DO 5.11 — Pembagi kontribusi item per transaksi untuk agregasi per-menu:
 * sub-bill split equal → totalSplitCount; semua transaksi lain → 1 (tidak berubah).
 */
export function splitContributionDivisor(tx: {
  splitIndex?: number;
  totalSplitCount?: number;
  subtotal: number;
  items: Array<{ subtotal: number }>;
}): number {
  return isEqualSplitSubBill(tx) ? (tx.totalSplitCount || 1) : 1;
}

/**
 * v4.5 TO DO 5.10 — Predicate sub-bill hasil split bill: transaksi anak (splitParentId terisi)
 * ATAU sub-bill split FRESH (splitIndex terisi tanpa parent, membawa semua item cart).
 * Dipakai filter KDS agar antrean dapur tidak ter-duplikasi oleh sub-bill.
 */
export function isSplitSubBill(tx: { splitParentId?: string; splitIndex?: number }): boolean {
  return !!tx.splitParentId || tx.splitIndex !== undefined;
}

export function buildEqualSplitReceipt(
  subTx: Transaction
): { header: string; items: CartItem[] } | null {
  // Satu sumber kebenaran deteksi: isEqualSplitSubBill (splitIndex + totalSplitCount + Σ item ≠ subtotal).
  // Mode item (item disjoint) & transaksi non-split → null (tidak diubah).
  if (!isEqualSplitSubBill(subTx)) return null;
  const itemsTotal = subTx.items.reduce((a, i) => a + i.subtotal, 0);
  if (itemsTotal <= 0 || subTx.subtotal <= 0) return null;

  const ratios = subTx.items.map((i) => i.subtotal / itemsTotal);
  const allocated = allocateProportional(subTx.subtotal, ratios);
  return {
    header: `BAGIAN ${subTx.splitIndex || 1} DARI ${subTx.totalSplitCount || 1} (NOMINAL RATA)`,
    items: subTx.items.map((i, idx) => ({ ...i, subtotal: allocated[idx] })),
  };
}
