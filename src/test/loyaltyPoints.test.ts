import { describe, it, expect } from 'vitest';
import {
  calculateEarnedPoints,
  calculateRedeemDiscount,
  calculateMaxRedeemablePoints,
} from '../utils/loyaltyPoints';
import type { LoyaltySettings } from '../types';

const settings: LoyaltySettings = {
  enabled: true,
  pointsPerTransaction: 1,
  pointsPerRupiah: 10000,
  redeemPointsValue: 1000,
  tierBronzeMinVisits: 5,
  tierSilverMinVisits: 15,
  tierGoldMinVisits: 30,
  tierBronzeDiscount: 5,
  tierSilverDiscount: 10,
  tierGoldDiscount: 15,
};

// ============================================================
// calculateEarnedPoints
// ============================================================

describe('calculateEarnedPoints (P-A8 — earn saat checkout)', () => {
  it('1 poin per transaksi + 1 poin per Rp 10.000', () => {
    expect(calculateEarnedPoints(10000, settings)).toBe(2); // 1 + 1
    expect(calculateEarnedPoints(25000, settings)).toBe(3); // 1 + 2
  });

  it('total di bawah 1 poin per rupiah → hanya poin dasar', () => {
    expect(calculateEarnedPoints(500, settings)).toBe(1);
  });

  it('total 0 / negatif → hanya poin dasar (tidak negatif)', () => {
    expect(calculateEarnedPoints(0, settings)).toBe(1);
    expect(calculateEarnedPoints(-100, settings)).toBe(1);
  });

  it('pointsPerTransaction 0 → murni dari belanja', () => {
    expect(calculateEarnedPoints(25000, { ...settings, pointsPerTransaction: 0 })).toBe(2);
  });

  it('pointsPerRupiah non-positif di-clamp ke 1 (tidak div-by-zero)', () => {
    expect(calculateEarnedPoints(10000, { ...settings, pointsPerRupiah: 0 })).toBe(10001);
  });
});

// ============================================================
// calculateRedeemDiscount
// ============================================================

describe('calculateRedeemDiscount (P-A8 — redeem jadi diskon)', () => {
  it('poin × nilai tukar', () => {
    expect(calculateRedeemDiscount(10, settings)).toBe(10000);
    expect(calculateRedeemDiscount(1, settings)).toBe(1000);
  });

  it('poin 0 / negatif → 0', () => {
    expect(calculateRedeemDiscount(0, settings)).toBe(0);
    expect(calculateRedeemDiscount(-5, settings)).toBe(0);
  });

  it('redeemPointsValue 0 → diskon 0 (poin tidak bernilai)', () => {
    expect(calculateRedeemDiscount(10, { ...settings, redeemPointsValue: 0 })).toBe(0);
  });
});

// ============================================================
// calculateMaxRedeemablePoints
// ============================================================

describe('calculateMaxRedeemablePoints (P-A8 — batas saldo & headroom)', () => {
  it('dibatasi saldo pelanggan', () => {
    expect(calculateMaxRedeemablePoints(5, 100000, settings)).toBe(5);
  });

  it('dibatasi headroom diskon (subtotal - diskon lain)', () => {
    // headroom Rp 5.000 → maks 5 poin (Rp 5.000)
    expect(calculateMaxRedeemablePoints(100, 5000, settings)).toBe(5);
    // headroom Rp 3.500 → floor → 3 poin
    expect(calculateMaxRedeemablePoints(100, 3500, settings)).toBe(3);
  });

  it('saldo 0 / headroom 0 → 0', () => {
    expect(calculateMaxRedeemablePoints(0, 100000, settings)).toBe(0);
    expect(calculateMaxRedeemablePoints(100, 0, settings)).toBe(0);
  });

  it('redeemPointsValue ≤ 0 → 0 (redeem nonaktif)', () => {
    expect(calculateMaxRedeemablePoints(100, 100000, { ...settings, redeemPointsValue: 0 })).toBe(0);
  });
});
