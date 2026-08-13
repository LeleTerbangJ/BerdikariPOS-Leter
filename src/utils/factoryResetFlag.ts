/**
 * Factory Reset Flag — v4.7 TO DO 12.1.3 / P-A1
 *
 * Setelah Factory Reset, cloud di-seed ulang HANYA dengan akun login + settings
 * (tanpa katalog/inventaris demo). Namun store `menus` & `inventory` memakai seed
 * bawaan sebagai initial state, dan pola `loadFromCloud` "cloud kosong → push
 * lokal" akan mengirim seed demo itu ke cloud pada boot berikutnya.
 *
 * Solusi: dataManager.factoryReset menyetel flag ini (safeStorage) sebelum reload;
 * `menuStore.loadFromCloud` & `inventoryStore.loadFromCloud` membaca & menghapusnya
 * sekali pada boot berikutnya untuk melewati cabang "push lokal" — cloud tetap
 * bersih dari data demo sampai klien mengisi data nyata.
 */
import { safeStorage } from './safeStorage';

export const FACTORY_RESET_SKIP_SEED_KEY = 'rempah-factory-seed-skip';

export function setFactoryResetSeedSkip(): void {
  try {
    safeStorage.setItem(FACTORY_RESET_SKIP_SEED_KEY, '1');
  } catch {
    /* noop */
  }
}

export function isFactoryResetSeedSkip(): boolean {
  try {
    return safeStorage.getItem(FACTORY_RESET_SKIP_SEED_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearFactoryResetSeedSkip(): void {
  try {
    safeStorage.removeItem(FACTORY_RESET_SKIP_SEED_KEY);
  } catch {
    /* noop */
  }
}
