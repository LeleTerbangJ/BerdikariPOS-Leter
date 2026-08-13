// ============================================================
// v4.7 TO DO 12.2.2 (P-A8): Poin Loyalty — Earn & Redeem
//
// Logika MURNI (tanpa store/efek samping) — teruji di
// src/test/loyaltyPoints.test.ts.
//
// Aturan:
// - EARN saat checkout: poin = pointsPerTransaction + floor(total / pointsPerRupiah)
// - REDEEM: 1 poin = redeemPointsValue rupiah diskon
// - Maks redeem dibatasi saldo poin & headroom diskon (subtotal - diskon lain)
//   agar diskon redeem SELALU terpakai penuh (tidak ada potongan parsial poin).
// ============================================================
import type { LoyaltySettings } from '../types';

/**
 * Poin yang didapat pelanggan dari satu transaksi senilai `totalAmount`.
 * pointsPerTransaction = poin dasar per transaksi; pointsPerRupiah = 1 poin per Rp X.
 * Nilai non-positif di-clamp agar tidak menghasilkan poin aneh (0 atau negatif).
 */
export function calculateEarnedPoints(totalAmount: number, ls: LoyaltySettings): number {
  const perTx = Math.max(0, Math.floor(ls.pointsPerTransaction || 0));
  const perRupiah = Math.max(1, Math.floor(ls.pointsPerRupiah || 0));
  const fromSpend = Math.floor(Math.max(0, totalAmount) / perRupiah);
  return perTx + fromSpend;
}

/**
 * Diskon rupiah dari penukaran sejumlah poin: points * redeemPointsValue.
 * Nilai non-positif di-clamp → 0 (poin tidak bernilai / input negatif).
 */
export function calculateRedeemDiscount(points: number, ls: LoyaltySettings): number {
  const value = Math.max(0, Math.floor(ls.redeemPointsValue || 0));
  return Math.max(0, Math.floor(points || 0)) * value;
}

/**
 * Maks poin yang boleh ditukar: tidak melebihi saldo pelanggan DAN tidak melebihi
 * headroom diskon (maxDiscount = subtotal - diskon lain). Bila redeemPointsValue ≤ 0
 * (poin tidak bernilai) → 0 (redeem nonaktif).
 */
export function calculateMaxRedeemablePoints(
  available: number,
  maxDiscount: number,
  ls: LoyaltySettings
): number {
  const value = Math.max(0, Math.floor(ls.redeemPointsValue || 0));
  if (value <= 0) return 0;
  const byBalance = Math.max(0, Math.floor(available || 0));
  const byHeadroom = Math.floor(Math.max(0, maxDiscount) / value);
  return Math.min(byBalance, byHeadroom);
}
