// ============================================================
// v4.10 P.4 — ITEM NON-MENU / CUSTOM (qty & harga bebas di POS)
//
// Helper MURNI untuk identifikasi item non-menu (Item Manual) dan
// klasifikasinya di laporan. Logika tunggal yang dipakai POS,
// printer, promo, Dashboard & ringkasan shift (satu sumber kebenaran).
//
// Identifikasi ganda (aman):
//  1. Flag eksplisit `isCustom === true` (P.4: lebih robust daripada
//     derive dari menuId, karena menu bisa dihapus di kemudian hari).
//  2. Fallback `menuId` berawalan `custom:` — melindungi transaksi lama
//     / lintas device yang dibuat sebelum flag ada (idempoten).
// ============================================================

/** Nama bucket laporan untuk semua item non-menu (Dashboard & ringkasan shift). */
export const CUSTOM_ITEM_BUCKET_NAME = 'Item Non-Menu';

/**
 * Key agregasi SINTETIS untuk bucket item non-menu — TIDAK mungkin bentrok
 * dengan nama menu nyata (R-A5). Menu asli bisa saja bernama "Item Non-Menu";
 * memakai nama sebagai KEY akan menggabungkan menu itu ke bucket custom.
 * Key ini hanya dipakai sebagai kunci Map agregasi; nama tampilan tetap
 * CUSTOM_ITEM_BUCKET_NAME.
 */
export const CUSTOM_ITEM_BUCKET_KEY = '__custom_bucket__';

/** Prefix menuId sintetis item manual — tidak bentrok dengan id menu UUID v4. */
export const CUSTOM_MENU_ID_PREFIX = 'custom:';

/** Apakah item adalah item non-menu (Item Manual)? */
export function isCustomItem(
  item: { isCustom?: boolean; menuId?: string } | null | undefined
): boolean {
  if (!item) return false;
  if (item.isCustom === true) return true;
  return typeof item.menuId === 'string' && item.menuId.startsWith(CUSTOM_MENU_ID_PREFIX);
}

/**
 * Key agregasi laporan per-barang: item custom dikelompokkan ke SATU bucket
 * (hindari 100 nama acak membanjiri "Menu Terlaris"); item menu tetap by menuId.
 * Key bucket custom memakai id sintetis (CUSTOM_ITEM_BUCKET_KEY) — R-A5: tidak
 * pernah bentrok dengan menuId/name menu nyata.
 */
export function customItemReportKey(item: {
  isCustom?: boolean;
  menuId?: string;
}): string {
  return isCustomItem(item) ? CUSTOM_ITEM_BUCKET_KEY : (item.menuId || '');
}

/** Nama tampilan agregasi laporan: bucket untuk custom, nama asli untuk menu. */
export function customItemReportName(item: {
  isCustom?: boolean;
  menuId?: string;
  name?: string;
}): string {
  return isCustomItem(item) ? CUSTOM_ITEM_BUCKET_NAME : (item.name || '');
}

/**
 * Apakah item non-menu layak TAMPIL di antrean dapur (KDS)?
 * - Menu biasa            → tampil.
 * - Item non-menu TANPA target dapur eksplisit → SEMBUNYI (tidak dicetak ke dapur —
 *   konsisten dgn guard printer P.4/R-A2; kasir jual sambal, dapur tidak perlu tahu).
 * - Item non-menu DENGAN kitchenTarget eksplisit (mis. 'ALL' / kategori dapur) → tampil
 *   (kasir sengaja mengirim pesanan ini ke dapur).
 * Dipakai filter antrean & status KDS (R-A3).
 */
export function shouldShowInKitchen(item: {
  isCustom?: boolean;
  menuId?: string;
  kitchenTarget?: string;
} | null | undefined): boolean {
  if (!item) return false;
  if (!isCustomItem(item)) return true;
  return !!item.kitchenTarget && item.kitchenTarget.trim() !== '';
}