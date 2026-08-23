import { describe, it, expect } from 'vitest';
import {
  calculateDiscountBreakdown,
  computeTotalDiscount,
  isPromoStackable,
} from '../utils/discountEngine';

const base = {
  subtotal: 100000,
  manualDiscount: 10000,
  promoDiscount: 20000,
  loyaltyDiscount: 5000,
};

// ============================================================
// isPromoStackable
// ============================================================

describe('isPromoStackable (P-A4 — default legacy)', () => {
  it('undefined (legacy) → bisa digabung', () => {
    expect(isPromoStackable(undefined)).toBe(true);
    expect(isPromoStackable({})).toBe(true);
    expect(isPromoStackable(null)).toBe(true);
  });

  it('true → bisa digabung; false → eksklusif', () => {
    expect(isPromoStackable({ stackable: true })).toBe(true);
    expect(isPromoStackable({ stackable: false })).toBe(false);
  });
});

// ============================================================
// Stackable — semua diskon dijumlahkan (perilaku lama)
// ============================================================

describe('calculateDiscountBreakdown — STACKABLE (P-A4)', () => {
  it('menjumlahkan manual + promo + loyalty, capped subtotal', () => {
    const r = calculateDiscountBreakdown(base);
    expect(r.totalDiscount).toBe(35000);
    expect(r.manualApplied).toBe(10000);
    expect(r.promoApplied).toBe(20000);
    expect(r.loyaltyApplied).toBe(5000);
    expect(r.mode).toBe('stacked');
  });

  it('promoStackable undefined → tetap stackable (legacy aman)', () => {
    const r = calculateDiscountBreakdown({ ...base, promoStackable: undefined });
    expect(r.totalDiscount).toBe(35000);
    expect(r.mode).toBe('stacked');
  });

  it('total diskon di-cap di subtotal (tidak pernah negatif / melebihi)', () => {
    const r = calculateDiscountBreakdown({
      subtotal: 20000,
      manualDiscount: 15000,
      promoDiscount: 10000,
      loyaltyDiscount: 5000,
    });
    expect(r.totalDiscount).toBe(20000);
  });

  it('semua nol → 0', () => {
    const r = calculateDiscountBreakdown({ subtotal: 100000, manualDiscount: 0, promoDiscount: 0, loyaltyDiscount: 0 });
    expect(r.totalDiscount).toBe(0);
  });

  it('subtotal 0 → 0 (tidak negatif walau diskon besar)', () => {
    const r = calculateDiscountBreakdown({ ...base, subtotal: 0 });
    expect(r.totalDiscount).toBe(0);
  });
});

// ============================================================
// Eksklusif (stackable=false) — auto best-deal
// ============================================================

describe('calculateDiscountBreakdown — EKSKLUSIF / best-deal (P-A4)', () => {
  it('promo lebih besar dari manual+loyalty → hanya promo yang berlaku', () => {
    const r = calculateDiscountBreakdown({ ...base, promoStackable: false });
    expect(r.totalDiscount).toBe(20000);
    expect(r.promoApplied).toBe(20000);
    expect(r.manualApplied).toBe(0);
    expect(r.loyaltyApplied).toBe(0);
    expect(r.mode).toBe('promo-exclusive');
  });

  it('manual+loyalty lebih besar dari promo → promo TIDAK berlaku (eksklusif)', () => {
    const r = calculateDiscountBreakdown({
      subtotal: 100000,
      manualDiscount: 30000,
      promoDiscount: 20000,
      loyaltyDiscount: 10000,
      promoStackable: false,
    });
    expect(r.totalDiscount).toBe(40000); // 30k manual + 10k loyalty
    expect(r.promoApplied).toBe(0);
    expect(r.manualApplied).toBe(30000);
    expect(r.loyaltyApplied).toBe(10000);
    expect(r.mode).toBe('non-promo');
  });

  it('seri (promo == non-promo) → promo menang (>=)', () => {
    const r = calculateDiscountBreakdown({
      subtotal: 100000,
      manualDiscount: 15000,
      promoDiscount: 20000,
      loyaltyDiscount: 5000,
      promoStackable: false,
    });
    expect(r.totalDiscount).toBe(20000);
    expect(r.mode).toBe('promo-exclusive');
  });

  it('eksklusif tetap di-cap subtotal', () => {
    const r = calculateDiscountBreakdown({
      subtotal: 15000,
      manualDiscount: 10000,
      promoDiscount: 30000,
      loyaltyDiscount: 5000,
      promoStackable: false,
    });
    expect(r.totalDiscount).toBe(15000);
  });

  it('alokasi display non-promo: manual dulu, sisanya loyalty (saat di-cap)', () => {
    const r = calculateDiscountBreakdown({
      subtotal: 30000,
      manualDiscount: 20000,
      promoDiscount: 0,
      loyaltyDiscount: 15000,
      promoStackable: false,
    });
    expect(r.totalDiscount).toBe(30000);
    expect(r.manualApplied).toBe(20000);
    expect(r.loyaltyApplied).toBe(10000); // sisa setelah cap
    expect(r.mode).toBe('non-promo');
  });
});

// ============================================================
// computeTotalDiscount — convenience
// ============================================================

describe('computeTotalDiscount (P-A4)', () => {
  it('sama dengan breakdown.totalDiscount (stacked & exclusive)', () => {
    expect(computeTotalDiscount(base)).toBe(35000);
    expect(computeTotalDiscount({ ...base, promoStackable: false })).toBe(20000);
  });
});

// ============================================================
// K1 fix (AUDIT-OX): redeem poin loyalty — additive di atas hasil mesin,
// capped subtotal. Default (tidak dikirim) = perilaku lama 100% identik.
// ============================================================

describe('calculateDiscountBreakdown - redeemDiscount (K1 fix)', () => {
  it('tanpa redeem → hasil identik perilaku lama', () => {
    const r = calculateDiscountBreakdown(base);
    expect(r.totalDiscount).toBe(35000);
    expect(r.mode).toBe('stacked');
  });

  it('redeem ditambahkan di atas total mesin (stacked)', () => {
    const r = calculateDiscountBreakdown({ ...base, redeemDiscount: 5000 });
    expect(r.totalDiscount).toBe(40000); // 35000 + 5000
  });

  it('redeem ikut di-cap subtotal (35000 + 70000 → max 100000)', () => {
    const r = calculateDiscountBreakdown({ ...base, redeemDiscount: 70000 });
    expect(r.totalDiscount).toBe(100000);
  });

  it('redeem TIDAK ikut kompetisi best-deal promo eksklusif (ditambah setelahnya)', () => {
    // Promo 60000 vs nonPromo 15000 → best-deal promo 60000; redeem 5000 tetap ditambahkan
    const r = calculateDiscountBreakdown({
      ...base,
      manualDiscount: 5000,
      promoDiscount: 60000,
      promoStackable: false,
      redeemDiscount: 5000,
    });
    expect(r.mode).toBe('promo-exclusive');
    expect(r.promoApplied).toBe(60000);
    expect(r.totalDiscount).toBe(65000);
  });

  it('redeem negatif/NaN diperlakukan 0', () => {
    expect(calculateDiscountBreakdown({ ...base, redeemDiscount: -500 }).totalDiscount).toBe(35000);
    expect(calculateDiscountBreakdown({ ...base, redeemDiscount: NaN }).totalDiscount).toBe(35000);
  });
});
