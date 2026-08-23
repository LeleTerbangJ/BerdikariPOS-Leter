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
  /**
   * K1 fix (AUDIT-OX): diskon penukaran poin loyalty — nilai yang sudah "dibayar"
   * pelanggan dengan poinnya. SELALU ditambahkan DI ATAS hasil mesin (di luar logika
   * stacking/best-deal promo), konsisten dengan rumus handleSavePending & preview.
   * Default 0 → perilaku semua pemanggil existing 100% identik.
   */
  redeemDiscount?: number;
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
  const redeem = Math.max(0, Math.round(input.redeemDiscount ?? 0));

  let breakdown: DiscountBreakdown;
  if (stackable) {
    const total = Math.min(Math.round(manualDiscount + promoDiscount + loyaltyDiscount), safeSubtotal);
    breakdown = {
      totalDiscount: total,
      manualApplied: Math.round(manualDiscount),
      promoApplied: Math.round(promoDiscount),
      loyaltyApplied: Math.round(loyaltyDiscount),
      mode: 'stacked',
    };
  } else {
    // Promo EKSKLUSIF — auto best-deal (pilih yang lebih besar)
    const nonPromo = Math.round(manualDiscount + loyaltyDiscount);
    if (promoDiscount >= nonPromo) {
      const total = Math.min(Math.round(promoDiscount), safeSubtotal);
      breakdown = {
        totalDiscount: total,
        manualApplied: 0,
        promoApplied: total,
        loyaltyApplied: 0,
        mode: 'promo-exclusive',
      };
    } else {
      const total = Math.min(nonPromo, safeSubtotal);
      const manualApplied = Math.min(Math.round(manualDiscount), total);
      breakdown = {
        totalDiscount: total,
        manualApplied,
        promoApplied: 0,
        loyaltyApplied: Math.max(0, total - manualApplied),
        mode: 'non-promo',
      };
    }
  }

  // K1 fix: redeem ditambahkan setelah mesin (bukan ikut best-deal) — nilai tukar poin
  // adalah "nilai yang sudah dibayar", bukan komponen promo. Capped di subtotal.
  if (redeem > 0 && breakdown.totalDiscount < safeSubtotal) {
    breakdown.totalDiscount = Math.min(breakdown.totalDiscount + redeem, safeSubtotal);
  }
  return breakdown;
}

export function computeTotalDiscount(input: DiscountEngineInput): number {
  return calculateDiscountBreakdown(input).totalDiscount;
}
