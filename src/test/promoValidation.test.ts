import { describe, it, expect } from 'vitest';
import { validatePromoForm, type PromoFormValues } from '../utils/promoValidation';

function base(overrides: Partial<PromoFormValues> = {}): PromoFormValues {
  return {
    name: 'Promo Akhir Pekan',
    type: 'percentage',
    value: 10,
    scope: 'all',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    ...overrides,
  };
}

// ============================================================
// TO DO 12.2 / P-A2 — validasi form promo
// ============================================================

describe('validatePromoForm — kasus valid', () => {
  it('promo all/percentage tanpa angka opsional → valid', () => {
    expect(validatePromoForm(base())).toEqual({ valid: true, errors: [] });
  });

  it('scope menu dengan target menu → valid', () => {
    expect(validatePromoForm(base({ scope: 'menu', scopeTarget: 'menu-1' })).valid).toBe(true);
  });

  it('scope category dengan target kategori → valid', () => {
    expect(validatePromoForm(base({ scope: 'category', scopeTarget: 'Minuman' })).valid).toBe(true);
  });

  it('scope loyalty dengan min kunjungan → valid', () => {
    expect(validatePromoForm(base({ scope: 'loyalty', loyaltyMinVisits: 5 })).valid).toBe(true);
  });

  it('fixed dengan min belanja ≥ nilai → valid', () => {
    expect(validatePromoForm(base({ type: 'fixed', value: 5000, minPurchase: 10000 })).valid).toBe(true);
  });

  it('tanggal mulai = tanggal berakhir → valid', () => {
    expect(validatePromoForm(base({ startDate: '2026-08-10', endDate: '2026-08-10' })).valid).toBe(true);
  });

  it('P-A6: batas pemakaian per pelanggan ≥ 1 → valid', () => {
    expect(validatePromoForm(base({ usageLimitPerCustomer: 1 })).valid).toBe(true);
    expect(validatePromoForm(base({ usageLimitPerCustomer: 3 })).valid).toBe(true);
  });
});

describe('validatePromoForm — kasus tidak valid', () => {
  it('nama kosong', () => {
    const r = validatePromoForm(base({ name: '  ' }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('Nama'))).toBe(true);
  });

  it('persentase 0 atau > 100 ditolak', () => {
    expect(validatePromoForm(base({ value: 0 })).valid).toBe(false);
    expect(validatePromoForm(base({ value: 150 })).valid).toBe(false);
    expect(validatePromoForm(base({ value: 100 })).valid).toBe(true);
  });

  it('nominal tetap 0 atau negatif ditolak', () => {
    expect(validatePromoForm(base({ type: 'fixed', value: 0 })).valid).toBe(false);
    expect(validatePromoForm(base({ type: 'fixed', value: -500 })).valid).toBe(false);
  });

  it('tanggal berakhir sebelum mulai ditolak', () => {
    const r = validatePromoForm(base({ startDate: '2026-08-31', endDate: '2026-08-01' }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('berakhir'))).toBe(true);
  });

  it('tanggal mulai/berakhir kosong ditolak', () => {
    expect(validatePromoForm(base({ startDate: '' })).valid).toBe(false);
    expect(validatePromoForm(base({ endDate: '' })).valid).toBe(false);
  });

  it('scope menu tanpa target ditolak', () => {
    const r = validatePromoForm(base({ scope: 'menu', scopeTarget: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('menu'))).toBe(true);
  });

  it('scope category tanpa target ditolak', () => {
    expect(validatePromoForm(base({ scope: 'category', scopeTarget: '' })).valid).toBe(false);
  });

  it('scope loyalty tanpa min kunjungan ditolak', () => {
    const r = validatePromoForm(base({ scope: 'loyalty', loyaltyMinVisits: 0 }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.toLowerCase().includes('kunjungan'))).toBe(true);
  });

  it('nilai diskon tetap melebihi min belanja ditolak', () => {
    const r = validatePromoForm(base({ type: 'fixed', value: 15000, minPurchase: 10000 }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('min. belanja'))).toBe(true);
  });

  it('angka opsional negatif ditolak', () => {
    expect(validatePromoForm(base({ minPurchase: -1 })).valid).toBe(false);
    expect(validatePromoForm(base({ maxDiscount: -1 })).valid).toBe(false);
    expect(validatePromoForm(base({ usageLimit: -1 })).valid).toBe(false);
  });

  it('P-A6: batas per pelanggan 0 atau negatif ditolak', () => {
    const r0 = validatePromoForm(base({ usageLimitPerCustomer: 0 }));
    expect(r0.valid).toBe(false);
    expect(r0.errors.some((e) => e.includes('per pelanggan'))).toBe(true);
    expect(validatePromoForm(base({ usageLimitPerCustomer: -2 })).valid).toBe(false);
  });

  it('form kosong menghasilkan banyak error', () => {
    const r = validatePromoForm({ name: '', type: 'percentage', value: 0, scope: 'all', startDate: '', endDate: '' });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
});
