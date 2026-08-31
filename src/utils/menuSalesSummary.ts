// ============================================================
// v4.10 P.4 — Agregasi MENU SALES untuk Ringkasan Shift (murni)
//
// Dipakai Layout (cetak ringkasan tutup shift). Item non-menu
// (Item Manual) dikelompokkan ke SATU bucket "Item Non-Menu"
// dengan HPP dari customHpp → baris bucket menampilkan LABA
// KOTOR (revenue − customHpp) di struk ringkasan shift.
// ============================================================
import type { CartItem } from '../types';
import { isCustomItem, CUSTOM_ITEM_BUCKET_NAME, CUSTOM_ITEM_BUCKET_KEY } from './customItem';

export interface MenuSalesSummaryRow {
  name: string;    // nama menu ATAU bucket "Item Non-Menu"
  qty: number;
  revenue: number; // Σ subtotal
  hpp: number;     // Σ HPP snapshot item (custom → customHpp × qty; legacy → 0)
  profit: number;  // revenue − hpp (laba kotor)
}

/**
 * Agregasi penjualan per baris untuk ringkasan shift.
 * - Skip bundle PARENT (child yang dihitung — perilaku lama).
 * - Item menu dikelompokkan by NAMA (perilaku lama ringkasan shift).
 * - Item non-menu dikelompokkan ke bucket "Item Non-Menu".
 */
export function buildMenuSalesSummary(
  txs: { items: CartItem[] }[]
): MenuSalesSummaryRow[] {
  const map: Record<string, MenuSalesSummaryRow> = {};

  txs.forEach((t) => {
    (t.items || []).forEach((item) => {
      if (item.isBundle) return; // skip bundle parent, ambil child saja
      // R-A5: key bucket custom memakai id sintetis (CUSTOM_ITEM_BUCKET_KEY) agar tidak
      // pernah bentrok dengan nama menu nyata; nama tampilan tetap CUSTOM_ITEM_BUCKET_NAME.
      const key = isCustomItem(item) ? CUSTOM_ITEM_BUCKET_KEY : item.name;
      if (!map[key]) map[key] = { name: isCustomItem(item) ? CUSTOM_ITEM_BUCKET_NAME : item.name, qty: 0, revenue: 0, hpp: 0, profit: 0 };
      const row = map[key];
      row.qty += item.quantity;
      row.revenue += item.subtotal;
      // HPP snapshot tiap item sudah berskala qty (item.hpp/cogs). Untuk item non-menu
      // = customHpp × qty (snapshot `manual_custom_*`); legacy tanpa snapshot → 0.
      row.hpp += item.cogs ?? item.hpp ?? 0;
    });
  });

  const rows = Object.values(map);
  rows.forEach((r) => {
    r.profit = r.revenue - r.hpp;
  });
  return rows.sort((a, b) => b.qty - a.qty); // terlaris di atas (perilaku lama)
}