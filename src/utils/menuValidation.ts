import type { AddOn } from '../types';

/**
 * v4.7 TO DO 15.1 — Validasi harga add-on: tidak boleh 0 / negatif / bukan angka.
 * Dulu `Catalog.handleSave` memakai `.filter(a => a.name && parseInt(a.price))` yang
 * meng-DROP add-on harga 0/NaN DIAM-DIAM tanpa pesan. Sekarang baris invalid
 * dicatat sebagai problem dan pemanggil memblokir simpan (toast jelas).
 */

export interface AddOnFormRow {
  name: string;
  price: string | number;
}

export interface AddOnValidationResult {
  addons: AddOn[];
  problems: string[];
}

/**
 * Validasi baris add-on dari form katalog.
 * - Baris kosong (nama & harga kosong) di-skip tanpa masalah.
 * - Baris invalid (nama kosong tapi harga terisi, atau harga ≤ 0 / bukan angka)
 *   dicatat di `problems` — TIDAK di-drop diam-diam.
 */
export function validateAddOnForm(rows: AddOnFormRow[]): AddOnValidationResult {
  const result: AddOnValidationResult = { addons: [], problems: [] };
  (rows || []).forEach((row, idx) => {
    const name = String(row?.name ?? '').trim();
    const rawPrice = String(row?.price ?? '').trim();
    if (!name && !rawPrice) return; // baris kosong — abaikan
    if (!name) {
      result.problems.push(`Add-on baris ${idx + 1}: nama wajib diisi.`);
      return;
    }
    const price = Number(rawPrice);
    if (!Number.isFinite(price) || price <= 0) {
      result.problems.push(`Add-on "${name}": harga harus lebih dari 0.`);
      return;
    }
    result.addons.push({ name, price: Math.round(price) });
  });
  return result;
}

export interface ImportedAddOnResult {
  addons: AddOn[];
  dropped: number;
  parseFailed: boolean;
}

/**
 * Validasi add-on hasil JSON.parse dari kolom CSV (availableAddons).
 * Entry tidak valid (nama kosong / harga ≤ 0 / bukan angka) di-drop dan dihitung —
 * import tetap berjalan, jumlah yang dibuang dilaporkan ke user.
 */
export function sanitizeImportedAddOns(raw: unknown): ImportedAddOnResult {
  const result: ImportedAddOnResult = { addons: [], dropped: 0, parseFailed: false };
  if (!Array.isArray(raw)) {
    if (raw !== undefined && raw !== null && raw !== '') result.dropped = 1;
    return result;
  }
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      result.dropped += 1;
      continue;
    }
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    const price = Number(e.price);
    if (!name || !Number.isFinite(price) || price <= 0) {
      result.dropped += 1;
      continue;
    }
    result.addons.push({ name, price: Math.round(price) });
  }
  return result;
}

/**
 * Parse kolom addons CSV yang aman (try/catch): JSON rusak tidak menggagalkan
 * seluruh import — ditandai `parseFailed` agar pemanggil bisa melaporkannya.
 */
export function parseImportedAddOns(json: string): ImportedAddOnResult {
  try {
    return sanitizeImportedAddOns(JSON.parse(json));
  } catch {
    return { addons: [], dropped: 0, parseFailed: true };
  }
}
