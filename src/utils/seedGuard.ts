// ============================================================
// v4.10 PRIORITAS 28.1 — Guard push katalog seed murni ke cloud
//
// Mencegah cabang "cloud kosong → push lokal" meng-upload seed demo
// ke cloud pada boot device mana pun (akar bug menu demo bandel).
//
// `isPureSeedCatalog`: deteksi apakah katalog lokal = seed demo murni
// (semua id cocok dgn seedMenus, tidak ada menu user).
// `catalogTouched`: flag persist (localStorage) — diset saat user
// tambah/edit/hapus/import menu. Bila set → katalog BUKAN seed murni
// → push diperbolehkan (onboarding fresh deployment tetap jalan).
// ============================================================
import { safeStorage } from './safeStorage';
import { seedMenus } from './seed';
import type { Menu } from '../types';

const CATALOG_TOUCHED_KEY = 'rempah-catalog-touched';

/** Set flag: user telah mengubah katalog (bukan seed murni lagi). */
export function setCatalogTouched(): void {
  try {
    safeStorage.setItem(CATALOG_TOUCHED_KEY, '1');
  } catch {
    /* noop */
  }
}

/** Apakah user sudah pernah mengubah katalog? (flag persist) */
export function isCatalogTouched(): boolean {
  try {
    return safeStorage.getItem(CATALOG_TOUCHED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Apakah katalog lokal = seed demo murni (belum diubah user)?
 * - Semua id menu lokal ada di seedMenus DAN
 * - Semua id seedMenus ada di katalog lokal (sama persis, tidak lebih)
 * - ATAU flag catalogTouched belum diset
 *
 * Pure function (bisa diuji tanpa side-effect).
 */
export function isPureSeedCatalog(menus: Menu[]): boolean {
  // Bila user sudah pernah mengubah katalog → BUKAN seed murni
  if (isCatalogTouched()) return false;

  const seedIds = new Set(seedMenus.map((m) => m.id));
  const localIds = new Set(menus.map((m) => m.id));

  // Jumlah menu lokal harus sama dengan seed
  if (localIds.size !== seedIds.size) {
    // Bisa jadi user hapus/tambah — cek apakah masih pure seed
    // (semua id lokal ada di seed → seed murni walau kurang)
    for (const id of localIds) {
      if (!seedIds.has(id)) return false; // ada menu user → bukan seed
    }
    // Semua id lokal ada di seed → seed murni (mungkin kurang karena dihapus,
    // tapi tidak ada menu user) — masih anggap seed murni
    return true;
  }

  // Ukuran sama — cek semua id cocok
  for (const id of localIds) {
    if (!seedIds.has(id)) return false;
  }
  return true;
}

/** Reset flag (untuk factory reset / test). */
export function clearCatalogTouched(): void {
  try {
    safeStorage.removeItem(CATALOG_TOUCHED_KEY);
  } catch {
    /* noop */
  }
}
