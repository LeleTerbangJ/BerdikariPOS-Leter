import { describe, it, expect } from 'vitest';
import {
  validateAddOnForm,
  sanitizeImportedAddOns,
  parseImportedAddOns,
} from '../utils/menuValidation';

// ============================================================
// TO DO 15.1 (revisi) — Validasi harga add-on: harga 0 = GRATIS (SAH),
// negatif / bukan angka diblokir (form katalog & import CSV)
// ============================================================

describe('validateAddOnForm', () => {
  it('mengembalikan add-on valid & melewati baris kosong tanpa masalah', () => {
    const res = validateAddOnForm([
      { name: 'Telur', price: '3000' },
      { name: '', price: '' }, // baris kosong — abaikan
      { name: 'Keju', price: 5000 },
    ]);
    expect(res.problems).toEqual([]);
    expect(res.addons).toEqual([
      { name: 'Telur', price: 3000 },
      { name: 'Keju', price: 5000 },
    ]);
  });

  it('mengizinkan add-on GRATIS (harga 0 / kolom harga kosong)', () => {
    const res = validateAddOnForm([
      { name: 'Saus Sambal', price: '0' },
      { name: 'Saus Keju', price: 0 },
      { name: 'Saus Tomat', price: '' }, // kosong → 0 (gratis)
    ]);
    expect(res.problems).toEqual([]);
    expect(res.addons).toEqual([
      { name: 'Saus Sambal', price: 0 },
      { name: 'Saus Keju', price: 0 },
      { name: 'Saus Tomat', price: 0 },
    ]);
  });

  it('memblokir harga negatif & bukan angka (bukan drop diam-diam)', () => {
    const resNeg = validateAddOnForm([{ name: 'X', price: '-1000' }]);
    expect(resNeg.addons).toEqual([]);
    expect(resNeg.problems).toEqual(['Add-on "X": harga tidak boleh negatif atau bukan angka.']);
    expect(validateAddOnForm([{ name: 'X', price: 'abc' }]).problems.length).toBe(1);
  });

  it('memblokir baris dengan harga terisi tapi nama kosong', () => {
    const res = validateAddOnForm([{ name: '', price: '2000' }]);
    expect(res.addons).toEqual([]);
    expect(res.problems).toEqual(['Add-on baris 1: nama wajib diisi.']);
  });

  it('membulatkan harga desimal ke integer', () => {
    const res = validateAddOnForm([{ name: 'Topping', price: '2500.6' }]);
    expect(res.addons).toEqual([{ name: 'Topping', price: 2501 }]);
  });

  it('mengumpulkan beberapa masalah sekaligus (harga 0 tidak lagi masalah)', () => {
    const res = validateAddOnForm([
      { name: 'A', price: '0' }, // gratis — valid
      { name: 'B', price: '-1' }, // negatif — masalah
      { name: '', price: '5000' }, // nama kosong — masalah
    ]);
    expect(res.problems.length).toBe(2);
    expect(res.addons).toEqual([{ name: 'A', price: 0 }]);
  });
});

describe('sanitizeImportedAddOns', () => {
  it('mempertahankan add-on valid dari CSV', () => {
    const res = sanitizeImportedAddOns([
      { name: 'Extra Shot', price: 4000 },
      { name: 'Susu Oat', price: 8000 },
    ]);
    expect(res.addons).toEqual([
      { name: 'Extra Shot', price: 4000 },
      { name: 'Susu Oat', price: 8000 },
    ]);
    expect(res.dropped).toBe(0);
  });

  it('menghitung add-on invalid (harga negatif/NaN/nama kosong) sebagai dropped — harga 0 GRATIS dipertahankan', () => {
    const res = sanitizeImportedAddOns([
      { name: 'A', price: 1000 },
      { name: 'Gratis', price: 0 }, // harga 0 → SAH (add-on gratis)
      { name: 'Minus', price: -500 }, // negatif → drop
      { name: 'NaN', price: 'bukan-angka' }, // bukan angka → drop
      { name: '', price: 2000 }, // nama kosong → drop
      { name: 'Desimal', price: 3500.4 }, // valid → round 3500
      'bukan-objek', // non-objek → drop
    ]);
    expect(res.addons).toEqual([
      { name: 'A', price: 1000 },
      { name: 'Gratis', price: 0 },
      { name: 'Desimal', price: 3500 },
    ]);
    expect(res.dropped).toBe(4);
  });

  it('menangani input non-array (string/object/null)', () => {
    expect(sanitizeImportedAddOns(null).addons).toEqual([]);
    expect(sanitizeImportedAddOns(undefined).addons).toEqual([]);
    expect(sanitizeImportedAddOns('{}').dropped).toBe(1);
    expect(sanitizeImportedAddOns({ name: 'X', price: 1000 }).dropped).toBe(1);
  });
});

describe('parseImportedAddOns', () => {
  it('mem-parse JSON valid — harga 0 dipertahankan (add-on gratis)', () => {
    const res = parseImportedAddOns('[{"name":"A","price":1000},{"name":"B","price":0},{"name":"C","price":-1}]');
    expect(res.addons).toEqual([
      { name: 'A', price: 1000 },
      { name: 'B', price: 0 },
    ]);
    expect(res.dropped).toBe(1);
    expect(res.parseFailed).toBe(false);
  });

  it('JSON rusak tidak melempar — ditandai parseFailed, import tetap jalan', () => {
    const res = parseImportedAddOns('{name: rusak');
    expect(res.parseFailed).toBe(true);
    expect(res.addons).toEqual([]);
  });
});
