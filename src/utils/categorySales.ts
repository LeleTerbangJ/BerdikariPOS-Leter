// ============================================================
// v4.10 R-A4 — Agregasi PENJUALAN PER KATEGORI untuk Reports (murni)
//
// Diekstrak dari useMemo `categorySales` Reports agar bisa diuji.
// Item non-menu (Item Manual) dikelompokkan ke bucket "Item Non-Menu"
// — konsisten dgn Dashboard & ringkasan shift (bukan "Lainnya").
// ============================================================
import type { Transaction, Menu } from '../types';
import { isCustomItem, CUSTOM_ITEM_BUCKET_NAME } from './customItem';
import { splitContributionDivisor } from './splitAllocation';

export interface CategorySalesRow {
  revenue: number;
  qty: number;
}

/**
 * Agregasi revenue & qty per kategori untuk laporan (P&L breakdown, tabel, PDF).
 * - Child bundle dilewati (operational record saja).
 * - Sub-bill split equal dinormalisasi via splitContributionDivisor.
 * - Item non-menu → bucket "Item Non-Menu" (R-A4), bukan "Lainnya".
 * Urut by revenue desc.
 */
export function buildCategorySales(
  txs: Transaction[],
  menus: Menu[]
): Array<[string, CategorySalesRow]> {
  const map: Record<string, CategorySalesRow> = {};

  txs.forEach((t) => {
    const div = splitContributionDivisor(t);
    t.items.forEach((item) => {
      if (item.isBundleChild) return; // Child bundle items are operational records only
      const menu = menus.find((m) => m.id === item.menuId);
      // v4.10 R-A4: item non-menu (Item Manual) → bucket "Item Non-Menu"
      const cat = isCustomItem(item) ? CUSTOM_ITEM_BUCKET_NAME : (menu?.category || 'Lainnya');
      if (!map[cat]) map[cat] = { revenue: 0, qty: 0 };
      map[cat].revenue += item.subtotal / div;
      map[cat].qty += item.quantity / div;
    });
  });

  return Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue);
}