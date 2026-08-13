/**
 * Data Manager — Reset demo data & clear production data
 *
 * Three levels of reset:
 * 1. resetToDefault: Reset penuh ke seed DEMO (users+settings+menus+inventory) — untuk demo/testing.
 * 2. clearOperationalData: Clear transactions/logs, preserves users/menus/inventory/settings.
 * 3. factoryReset: Full wipe; re-seed HANYA akun login + settings ke cloud (cloud BERSIH dari
 *    katalog/inventaris demo) — untuk serah terima klien baru / fresh start.
 *
 * v4.7 TO DO 12.1.1/12.1.2 (fix):
 * - Penghapusan lokal memakai ADAPTER yang benar: store `transactions` & `audit-logs`
 *   persist di IndexedDB (`idbStorage`) sejak TO DO 6.1 — `localStorage.removeItem`
 *   saja TIDAK menghapusnya. Kini dihapus via `clearIdbKeys` (await sebelum reload).
 * - `rempah-cash-movements` (Rekap Kas) ikut dibersihkan lokal + cloud (`cash_movements`).
 *
 * v4.7 TO DO 12.1.3 / P-A1:
 * - `resetToDefault` vs `factoryReset` dibedakan (seed minimal untuk factory reset).
 * - Audit log aksi reset ditulis ke cloud SETELAH cloud di-wipe (survive reload;
 *   antre via offline queue bila offline).
 * - Flag skip-seed mencegah katalog demo lokal ter-push balik ke cloud pasca factory reset.
 *
 * v4.7 TO DO 12.1.4 / 12.1.5:
 * - `menu_components` (struktur bundle) ikut di-wipe pada reset penuh — tidak ada komponen yatim.
 * - Offline queue dibersihkan PALING AWAL di setiap aksi — op yang masih antre tidak
 *   "bangkit lagi" (flush ulang) setelah cloud di-wipe.
 */

import { v4 as uuid } from 'uuid';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { clearQueue } from '../lib/offlineQueue';
import { syncUser, syncSettings, syncMenu, syncInventoryItem, syncAuditLog } from '../lib/cloudSync';
import { seedUsers, seedMenus, seedInventory, seedSettings } from './seed';
import { clearIdbKeys } from './idbStorage';
import { safeStorage } from './safeStorage';
import {
  setFactoryResetSeedSkip,
  clearFactoryResetSeedSkip,
} from './factoryResetFlag';
import type { Role } from '../types';
import bcrypt from 'bcryptjs';

/** Identitas pelaku aksi reset (untuk audit log). */
export interface ResetActor {
  id: string;
  name: string;
  role: Role;
}

/** Key persist yang disimpan di IndexedDB (bukan localStorage) — wajib dihapus via adapter IDB. */
export const IDB_BACKED_KEYS = ['rempah-transactions', 'rempah-audit-logs'];

/** Semua key persist aplikasi (untuk reset penuh: Reset ke Default / Factory Reset). */
export const FULL_RESET_KEYS = [
  'rempah-auth',
  'rempah-menus',
  'rempah-inventory',
  'rempah-transactions',
  'rempah-cart',
  'rempah-customers',
  'rempah-shifts',
  'rempah-settings',
  'rempah-stock-logs',
  'rempah-promos',
  'rempah-audit-logs',
  'rempah-stock-opnames',
  'rempah-cash-movements', // v4.7 TO DO 12.1.2: Rekap Kas ikut direset
];

/** Key data operasional (untuk Bersihkan Data Transaksi). Master data tetap: users/menus/inventory/settings. */
export const OPERATIONAL_CLEAR_KEYS = [
  'rempah-transactions',
  'rempah-cart',
  'rempah-shifts',
  'rempah-customers',
  'rempah-stock-logs',
  'rempah-audit-logs',
  'rempah-promos',
  'rempah-stock-opnames',
  'rempah-cash-movements', // v4.7 TO DO 12.1.2: Rekap Kas ikut dibersihkan
];

/**
 * Rencana re-seed cloud — pembeda resetToDefault vs factoryReset (TO DO 12.1.3).
 * - 'demo'   : seed penuh (users + settings + menus + inventory) — kembalikan ke demo.
 * - 'factory': seed MINIMAL (users + settings saja) — cloud bersih dari katalog demo.
 */
export function reseedPlan(kind: 'demo' | 'factory'): {
  users: boolean;
  settings: boolean;
  menus: boolean;
  inventory: boolean;
} {
  if (kind === 'factory') {
    return { users: true, settings: true, menus: false, inventory: false };
  }
  return { users: true, settings: true, menus: true, inventory: true };
}

/** Pisahkan key IDB vs localStorage agar masing-masing dihapus via adapter yang benar. */
export function splitClearPlan(keys: string[]): { idbKeys: string[]; localKeys: string[] } {
  return {
    idbKeys: keys.filter((k) => IDB_BACKED_KEYS.includes(k)),
    localKeys: keys.filter((k) => !IDB_BACKED_KEYS.includes(k)),
  };
}

/**
 * Hapus data lokal via adapter yang benar. Key IndexedDB dihapus secara await
 * (selesai sebelum reload — mencegah data "ghost" kembali), sisanya via safeStorage.
 */
async function clearLocalData(keys: string[]) {
  const { idbKeys, localKeys } = splitClearPlan(keys);
  if (idbKeys.length > 0) await clearIdbKeys(idbKeys);
  localKeys.forEach((k) => safeStorage.removeItem(k));
}

/**
 * Catat aksi reset ke audit log CLOUD (dipanggil SETELAH cloud di-wipe agar entry survive
 * reload & tidak ikut terhapus). Bila offline, antre via offline queue (localStorage)
 * dan ter-flush otomatis saat online. Tanpa actor → cukup log console.
 */
function recordResetAudit(actor: ResetActor | undefined, detail: string) {
  if (!actor) {
    console.warn(`[DataManager] Reset tanpa actor terdeteksi: ${detail}`);
    return;
  }
  void syncAuditLog({
    id: uuid(),
    userId: actor.id,
    userName: actor.name,
    userRole: actor.role,
    action: 'reset_data',
    detail,
    timestamp: new Date().toISOString(),
    metadata: { source: 'dataManager' },
  });
}

/**
 * Reset ke Default (Demo Mode) — seed PENUH ke demo.
 * Menghapus SEMUA data (lokal + cloud) lalu re-seed users/settings/menus/inventory.
 * Setelah reload, data kembali ke seed demo dan di-sync ke cloud.
 */
export async function resetToDefault(actor?: ResetActor) {
  // 12.1.5: buang antrean offline yang mereferensikan data lama — jika tidak,
  // op yang masih antre bisa "bangkit lagi" setelah cloud di-wipe (flush ulang saat online).
  // Dilakukan PALING AWAL, sebelum cloud clear & sebelum recordResetAudit.
  clearQueue();

  // Clear cloud first, then re-seed full demo
  if (isSupabaseConfigured) {
    await clearAllCloudData();
    await reseedCloudData('demo');
    recordResetAudit(actor, 'Reset ke Default (Demo) — semua data dihapus & di-seed ulang');
  } else {
    recordResetAudit(actor, 'Reset ke Default (Demo) — lokal saja (cloud tidak dikonfigurasi)');
  }

  // Pastikan flag skip-seed (jika pernah tersetel) dibersihkan — demo restore HARUS push seed
  clearFactoryResetSeedSkip();

  // Clear all app persistence (IDB + localStorage) — v4.7 fix 12.1.1
  await clearLocalData(FULL_RESET_KEYS);

  // Reload app — will reinitialize with seed data
  window.location.reload();
}

/**
 * Clear Semua Transaksi & Data Operasional
 * Untuk fresh start (klien baru). Mempertahankan:
 * - Users (akun login)
 * - Settings (nama toko, logo, printer)
 * - Menus (katalog produk)
 * - Inventory (bahan baku)
 *
 * Menahpus:
 * - Transactions, Shifts, Customers, Audit logs, Stock logs, Cart, Promos,
 *   Cash movements (Rekap Kas) — v4.7 fix 12.1.2
 */
export async function clearOperationalData(actor?: ResetActor) {
  // 12.1.5: buang antrean offline (ops operasional lama) sebelum cloud di-wipe
  clearQueue();

  // Clear local via adapter yang benar (IDB + localStorage) — v4.7 fix 12.1.1
  await clearLocalData(OPERATIONAL_CLEAR_KEYS);

  // Also clear from Supabase if configured
  if (isSupabaseConfigured) {
    await clearCloudOperationalData();
    recordResetAudit(actor, 'Bersihkan Data Transaksi — data operasional dihapus (master data tetap)');
  } else {
    recordResetAudit(actor, 'Bersihkan Data Transaksi — lokal saja (cloud tidak dikonfigurasi)');
  }

  window.location.reload();
}

/**
 * Factory Reset — full wipe + seed MINIMAL (hanya akun login & settings ke cloud).
 * Cloud tidak diisi katalog/inventaris demo; flag skip-seed mencegah seed lokal
 * ter-push balik ke cloud pada boot berikutnya. Untuk serah terima / fresh start.
 */
export async function factoryReset(actor?: ResetActor) {
  // 12.1.5: buang antrean offline yang mereferensikan data lama
  clearQueue();

  // Clear cloud, then re-seed only essential data (users + settings)
  if (isSupabaseConfigured) {
    await clearAllCloudData();
    await reseedCloudData('factory');
    recordResetAudit(actor, 'Factory Reset — semua data dihapus, seed minimal (akun + settings)');
  } else {
    recordResetAudit(actor, 'Factory Reset — lokal saja (cloud tidak dikonfigurasi)');
  }

  // Cegah seed demo lokal ter-push ke cloud pada boot berikutnya
  setFactoryResetSeedSkip();

  // Clear all app persistence (IDB + localStorage) — v4.7 fix 12.1.1
  await clearLocalData(FULL_RESET_KEYS);

  window.location.reload();
}

// ============================================================
// Cloud helpers
// ============================================================

/** Tabel operasional yang di-wipe saat Bersihkan Data Transaksi (master data tetap). */
export const OPERATIONAL_WIPE_TABLES = [
  'transactions',
  'shifts',
  'customers',
  'audit_logs',
  'stock_logs',
  'promos',
  'stock_opnames',
  'cash_movements', // v4.7 fix 12.1.2: Rekap Kas ikut bersih
];

/** Semua tabel yang di-wipe saat reset penuh (Reset ke Default / Factory Reset). */
export const FULL_WIPE_TABLES = [
  ...OPERATIONAL_WIPE_TABLES,
  'menu_components', // v4.7 fix 12.1.4: bundle yatim ikut dihapus
  'menus',
  'inventory',
  'users',
  'settings',
];

async function clearCloudTables(tables: string[]) {
  for (const table of tables) {
    // settings memakai id=0 sebagai penanda khusus, sisanya id=''
    const filter = table === 'settings' ? { column: 'id', value: 0 } : { column: 'id', value: '' };
    await supabase.from(table).delete().neq(filter.column, filter.value);
  }
}

async function clearCloudOperationalData() {
  try {
    await clearCloudTables(OPERATIONAL_WIPE_TABLES);
  } catch (e) {
    console.warn('Cloud clear failed:', e);
  }
}

async function clearAllCloudData() {
  try {
    await clearCloudTables(FULL_WIPE_TABLES);
  } catch (e) {
    console.warn('Cloud factory reset failed:', e);
  }
}

/**
 * Re-seed data esensial ke cloud setelah full wipe — mengikuti reseedPlan(kind):
 * - 'demo': users + settings + menus + inventory (demo penuh).
 * - 'factory': users + settings saja (akun tetap bisa login; cloud bersih dari demo).
 */
async function reseedCloudData(kind: 'demo' | 'factory') {
  const plan = reseedPlan(kind);
  try {
    // 1. Re-seed users (most critical — admin must be able to login)
    // BUG-NEW-03 fix: Hash passwords before sending to cloud
    for (const user of seedUsers) {
      const hashedUser = {
        ...user,
        password: bcrypt.hashSync(user.password, 8),
      };
      await syncUser(hashedUser);
    }

    // 2. Re-seed settings
    await syncSettings(seedSettings);

    // 3. Re-seed menus (hanya untuk mode demo)
    if (plan.menus) {
      for (const menu of seedMenus) {
        await syncMenu(menu);
      }
    }

    // 4. Re-seed inventory (hanya untuk mode demo)
    if (plan.inventory) {
      for (const item of seedInventory) {
        await syncInventoryItem(item);
      }
    }

    console.log(`[DataManager] Cloud re-seeded (${kind})`);
  } catch (e) {
    console.warn('[DataManager] Cloud re-seed failed:', e);
  }
}
