// ============================================================
// v4.7 TO DO 12.2.3 (P-A4): Mesin Diskon POS — Stacking vs Eksklusif
//
// SATU-SATUNYA sumber kebenaran perhitungan total diskon di POS.
// Sebelumnya tiap call site menulis `manual + promo + loyalty` sendiri
// (duplikasi di finalizeTransaction, handleSavePending, dan preview) —
// tanpa aturan stacking. Helper ini memusatkan logika + hasil breakdown
// agar UI menampilkan angka yang SAMA dengan yang dicommit.
//
// Aturan:
// - Promo STACKABLE (default/legacy): semua diskon dijumlahkan, capped subtotal.
// - Promo EKSKLUSIF (stackable=false): AUTO BEST-DEAL — pelanggan mendapat yang
//   LEBIH BESAR antara (diskon promo saja) vs (diskon manual + loyalty saja).
//   Tidak pernah keduanya. Diskon tidak pernah melebihi subtotal.
// ============================================================
import type { Promo } from '../types';

export interface DiscountEngineInput {
  subtotal: number;
  manualDiscount: number;
  promoDiscount: number;
  loyaltyDiscount: number;
  /** stackable dari promo yang diterapkan; undefined dianggap true (legacy) */
  promoStackable?: boolean;
}

export type DiscountMode = 'stacked' | 'promo-exclusive' | 'non-promo';

export interface DiscountBreakdown {
  totalDiscount: number;
  manualApplied: number;
  promoApplied: number;
  loyaltyApplied: number;
  mode: DiscountMode;
}

/** Konversi nilai stackable promo (undefined = legacy = boleh digabung) */
export function isPromoStackable(promo?: Pick<Promo, 'stackable'> | null): boolean {
  return promo?.stackable !== false;
}

export function calculateDiscountBreakdown(input: DiscountEngineInput): DiscountBreakdown {
  const { subtotal, manualDiscount, promoDiscount, loyaltyDiscount } = input;
  const stackable = isPromoStackable({ stackable: input.promoStackable });
  const safeSubtotal = Math.max(0, subtotal);

  if (stackable) {
    const total = Math.min(Math.round(manualDiscount + promoDiscount + loyaltyDiscount), safeSubtotal);
    return {
      totalDiscount: total,
      manualApplied: Math.round(manualDiscount),
      promoApplied: Math.round(promoDiscount),
      loyaltyApplied: Math.round(loyaltyDiscount),
      mode: 'stacked',
    };
  }

  // Promo EKSKLUSIF — auto best-deal (pilih yang lebih besar)
  const nonPromo = Math.round(manualDiscount + loyaltyDiscount);
  if (promoDiscount >= nonPromo) {
    const total = Math.min(Math.round(promoDiscount), safeSubtotal);
    return {
      totalDiscount: total,
      manualApplied: 0,
      promoApplied: total,
      loyaltyApplied: 0,
      mode: 'promo-exclusive',
    };
  }

  const total = Math.min(nonPromo, safeSubtotal);
  const manualApplied = Math.min(Math.round(manualDiscount), total);
  return {
    totalDiscount: total,
    manualApplied,
    promoApplied: 0,
    loyaltyApplied: Math.max(0, total - manualApplied),
    mode: 'non-promo',
  };
}

export function computeTotalDiscount(input: DiscountEngineInput): number {
  return calculateDiscountBreakdown(input).totalDiscount;
}
