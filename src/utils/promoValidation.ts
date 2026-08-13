/**
 * Validasi Form Promo — v4.7 TO DO 12.2 / P-A2 (+ P-A5 BOGO & min-qty)
 *
 * Logika murni (bisa diuji tanpa UI) untuk memvalidasi input form promo sebelum disimpan:
 * - Nama wajib; nilai sesuai tipe (persentase 1–100%, nominal > 0)
 * - Tanggal mulai & berakhir wajib; berakhir ≥ mulai
 * - Scope `menu`/`category` wajib punya target; scope `loyalty` wajib min kunjungan
 * - Nilai diskon nominal tidak boleh melebihi min. belanja
 * - Angka opsional tidak boleh negatif
 * - BOGO (P-A5): beli ≥ 2, gratis ≥ 1, diskon per unit 0–100%; scope bukan loyalty
 * - minQty (P-A5): ≥ 1, hanya untuk tipe percentage/fixed
 */

export type PromoFormType = 'percentage' | 'fixed' | 'bogo';
export type PromoFormScope = 'all' | 'category' | 'menu' | 'loyalty';

export interface PromoFormValues {
  name: string;
  type: PromoFormType;
  value: number;
  scope: PromoFormScope;
  scopeTarget?: string;
  minPurchase?: number;
  maxDiscount?: number;
  startDate?: string; // yyyy-mm-dd (dari input date)
  endDate?: string;   // yyyy-mm-dd
  usageLimit?: number;
  loyaltyMinVisits?: number;
  // P-A5: BOGO & min-qty
  bogoBuyQty?: number;
  bogoFreeQty?: number;
  bogoPercent?: number;
  minQty?: number;
  // P-A6: batas pemakaian per pelanggan
  usageLimitPerCustomer?: number;
}

export interface PromoValidationResult {
  valid: boolean;
  errors: string[];
}

/** Bandingkan tanggal yyyy-mm-dd sebagai string (format ISO date — aman lexicographic). */
function dateLt(a: string, b: string): boolean {
  return a < b;
}

export function validatePromoForm(f: PromoFormValues): PromoValidationResult {
  const errors: string[] = [];

  if (!f.name?.trim()) errors.push('Nama promo wajib diisi.');

  if (f.type === 'bogo') {
    // BOGO: value tidak dipakai (dihitung per item) — validasi konfigurasi BOGO
    if (!(f.bogoBuyQty && f.bogoBuyQty >= 2)) {
      errors.push('BOGO: "Beli" minimal 2 item.');
    }
    if (f.bogoFreeQty !== undefined && f.bogoFreeQty < 1) {
      errors.push('BOGO: "Gratis" minimal 1 item.');
    }
    if (f.bogoPercent !== undefined && (f.bogoPercent < 0 || f.bogoPercent > 100)) {
      errors.push('BOGO: Diskon per item harus di antara 0% dan 100%.');
    }
    if (f.scope === 'loyalty') {
      errors.push('BOGO tidak bisa memakai scope "Pelanggan Loyal" — pilih Semua/Kategori/Menu.');
    }
  } else if (f.type === 'percentage') {
    if (!(f.value > 0 && f.value <= 100)) errors.push('Nilai persentase harus di antara 1% dan 100%.');
  } else {
    if (!(f.value > 0)) errors.push('Nilai diskon (Rp) harus lebih dari 0.');
  }

  if (!f.startDate) errors.push('Tanggal mulai wajib diisi.');
  if (!f.endDate) errors.push('Tanggal berakhir wajib diisi.');
  if (f.startDate && f.endDate && dateLt(f.endDate, f.startDate)) {
    errors.push('Tanggal berakhir tidak boleh sebelum tanggal mulai.');
  }

  if (f.scope === 'menu' && !f.scopeTarget?.trim()) {
    errors.push('Pilih menu untuk promo ini.');
  }
  if (f.scope === 'category' && !f.scopeTarget?.trim()) {
    errors.push('Pilih kategori untuk promo ini.');
  }
  if (f.scope === 'loyalty' && !(f.loyaltyMinVisits && f.loyaltyMinVisits > 0)) {
    errors.push('Min. kunjungan untuk promo loyalty wajib diisi (lebih dari 0).');
  }

  if (f.type === 'fixed' && f.minPurchase !== undefined && f.minPurchase > 0 && f.value > f.minPurchase) {
    errors.push('Nilai diskon (Rp) tidak boleh lebih besar dari min. belanja.');
  }

  if (f.minPurchase !== undefined && f.minPurchase < 0) errors.push('Min. belanja tidak boleh negatif.');
  if (f.maxDiscount !== undefined && f.maxDiscount < 0) errors.push('Maks. diskon tidak boleh negatif.');
  if (f.usageLimit !== undefined && f.usageLimit < 0) errors.push('Batas penggunaan tidak boleh negatif.');
  // P-A5: min-qty hanya untuk percentage/fixed, minimal 1
  if (f.minQty !== undefined && f.minQty < 0) errors.push('Min. qty tidak boleh negatif.');
  if (f.type !== 'bogo' && f.minQty !== undefined && f.minQty === 0) {
    errors.push('Min. qty harus lebih dari 0 (atau kosongkan).');
  }
  // P-A6: batas pemakaian per pelanggan minimal 1
  if (f.usageLimitPerCustomer !== undefined && f.usageLimitPerCustomer < 0) {
    errors.push('Batas pemakaian per pelanggan tidak boleh negatif.');
  }
  if (f.usageLimitPerCustomer !== undefined && f.usageLimitPerCustomer === 0) {
    errors.push('Batas pemakaian per pelanggan harus lebih dari 0 (atau kosongkan).');
  }

  return { valid: errors.length === 0, errors };
}
