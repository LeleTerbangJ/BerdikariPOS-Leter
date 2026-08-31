// ============================================================
// v4.10 P.4 — Profitabilitas MENU (30 hari) untuk Dashboard (murni)
//
// Diekstrak dari useMemo `menuProfitability` Dashboard agar bisa
// diuji. Item non-menu (Item Manual) dikelompokkan ke bucket
// "Item Non-Menu" dengan HPP dari customHpp → baris bucket
// menampilkan LABA KOTOR (revenue − customHpp) & margin.
// ============================================================
import type { Transaction, Menu, InventoryItem } from '../types';
import { calculateMenuHPP } from './hpp';
import { splitContributionDivisor } from './splitAllocation';
import { customItemReportKey, customItemReportName } from './customItem';

export interface MenuProfitabilityRow {
  name: string;
  qty: number;
  revenue: number;
  hpp: number;
  profit: number;
  margin: number; // % (0 bila revenue 0)
}

/**
 * Agregasi profitabilitas per menu 30 hari terakhir.
 * - Hanya transaksi Selesai, bukan sub-bill split & belum di-refund.
 * - Sub-bill split equal dinormalisasi via splitContributionDivisor.
 * - Item custom → bucket "Item Non-Menu"; HPP = customHpp × qty (snapshot).
 */
export function buildMenuProfitability(
  transactions: Transaction[],
  menus: Menu[],
  inventory: InventoryItem[],
  now: Date = new Date()
): MenuProfitabilityRow[] {
  const map: Record<string, { name: string; qty: number; revenue: number; hpp: number }> = {};

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const filterTxs = transactions.filter(
    (t) => new Date(t.date) >= thirtyDaysAgo && t.txStatus === 'Selesai' && !t.splitParentId && !t.refunded
  );

  filterTxs.forEach((t) => {
    // v4.5 TO DO 5.11: sub-bill split equal membawa semua item cart di tiap bagian dengan
    // subtotal/hpp penuh → qty/revenue/hpp per menu ter-inflasi N×. Bagi dengan totalSplitCount.
    const div = splitContributionDivisor(t);
    t.items.forEach((item) => {
      // v4.10 P.4: item non-menu dikelompokkan ke satu bucket "Item Non-Menu"
      const key = customItemReportKey(item);
      if (!map[key]) {
        map[key] = { name: customItemReportName(item), qty: 0, revenue: 0, hpp: 0 };
      }

      // Priority: Read permanent Snapshot HPP (item.hpp / item.cogs).
      // Fallback for legacy transactions created before snapshot feature.
      const menuObj = menus.find((m) => m.id === item.menuId);
      let itemHpp = item.cogs ?? item.hpp;
      if (itemHpp === undefined) {
        const menuHpp = menuObj ? calculateMenuHPP(menuObj, inventory) : 0;
        const baseHpp = menuObj && menuObj.price > 0 ? (item.basePrice / menuObj.price) * menuHpp : 0;
        itemHpp = baseHpp * item.quantity;
      }

      map[key].qty += item.quantity / div;
      map[key].revenue += item.subtotal / div;
      map[key].hpp += itemHpp / div;
    });
  });

  return Object.values(map)
    .map((m) => {
      const profit = m.revenue - m.hpp;
      const margin = m.revenue > 0 ? Math.round((profit / m.revenue) * 100) : 0;
      return { ...m, profit, margin };
    })
    .sort((a, b) => b.profit - a.profit);
}