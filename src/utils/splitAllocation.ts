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
export function buildEqualSplitReceipt(
  subTx: Transaction
): { header: string; items: CartItem[] } | null {
  const itemsTotal = subTx.items.reduce((a, i) => a + i.subtotal, 0);
  // Mode item (atau sub-bill yang memang berisi item-nya sendiri): Σ item = subtotal bill
  if (itemsTotal === subTx.subtotal) return null;
  if (itemsTotal <= 0 || subTx.subtotal <= 0) return null;

  const ratios = subTx.items.map((i) => i.subtotal / itemsTotal);
  const allocated = allocateProportional(subTx.subtotal, ratios);
  return {
    header: `BAGIAN ${subTx.splitIndex || 1} DARI ${subTx.totalSplitCount || 1} (NOMINAL RATA)`,
    items: subTx.items.map((i, idx) => ({ ...i, subtotal: allocated[idx] })),
  };
}
