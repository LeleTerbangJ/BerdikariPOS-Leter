// ============================================================
// v4.7 TO DO 12.2.5 (P-A5): Mesin Diskon Promo — BOGO & Min-Qty
//
// Logika MURNI (tanpa store/efek samping) — SATU-SATUNYA sumber
// kebenaran perhitungan diskon promo di POS (dipakai useCallback
// `calculatePromoDiscount` di POS.tsx). Teruji di
// src/test/promoDiscount.test.ts.
//
// Mendukung:
// - percentage / fixed (perilaku lama: % / nominal, maxDiscount, scope, minPurchase, loyalty)
// - BOGO (type='bogo'): beli N → gratis M unit dari item yang cocok scope.
//   Gratis diambil dari unit TERMURAH (kebijakan standar). bogoPercent>0 =
//   diskon sebagian per unit gratis (0 = gratis penuh).
// - minQty: gate untuk percentage/fixed — diskon hanya berlaku bila total qty
//   item target >= minQty.
// ============================================================
import type { Promo, CartItem, Menu, Customer } from '../types';

export interface PromoContext {
  cartItems: CartItem[];
  menus: Menu[];
  selectedCustomer?: Customer | null;
}

/** Harga satuan satu line item (base + addons) */
export function unitPrice(item: CartItem): number {
  return (item.basePrice || 0) + (item.addons || []).reduce((a, x) => a + (x.price || 0), 0);
}

/** Total qty item yang cocok scope promo (untuk gate scope & minQty) */
export function eligibleItemQty(promo: Promo, ctx: PromoContext): number {
  return ctx.cartItems.reduce((acc, item) => {
    if (promo.scope === 'menu' && promo.scopeTarget) {
      return acc + (item.menuId === promo.scopeTarget ? item.quantity : 0);
    }
    if (promo.scope === 'category' && promo.scopeTarget) {
      const menu = ctx.menus.find((m) => m.id === item.menuId);
      return acc + (menu && menu.category === promo.scopeTarget ? item.quantity : 0);
    }
    return acc + (promo.scope === 'all' ? item.quantity : 0);
  }, 0);
}

/** Apakah promo berlaku untuk keranjang ini (aktif, tanggal, usage, min belanja, loyalty, scope, minQty) */
export function isPromoApplicable(promo: Promo, subtotal: number, ctx: PromoContext): boolean {
  if (!promo.isActive) return false;
  const now = new Date();
  if (new Date(promo.startDate) > now) return false;
  if (new Date(promo.endDate) < now) return false;
  if (promo.usageLimit && promo.usageCount >= promo.usageLimit) return false;

  if (promo.minPurchase && subtotal < promo.minPurchase) return false;

  if (promo.scope === 'loyalty' && promo.loyaltyMinVisits) {
    if (!ctx.selectedCustomer || ctx.selectedCustomer.visitCount < promo.loyaltyMinVisits) return false;
  }

  // P-A6: batas pemakaian PER PELANGGAN — wajib ada pelanggan terpilih (tanpa pelanggan tidak bisa
  // dilacak → promo tidak berlaku), dan jumlah pakai pelanggan belum mencapai batas.
  if (promo.usageLimitPerCustomer && promo.usageLimitPerCustomer > 0) {
    const customer = ctx.selectedCustomer;
    if (!customer) return false;
    if ((promo.usageByCustomer?.[customer.id] || 0) >= promo.usageLimitPerCustomer) return false;
  }
  if (promo.scope === 'category' && promo.scopeTarget) {
    const has = ctx.cartItems.some((item) => {
      const menu = ctx.menus.find((m) => m.id === item.menuId);
      return menu && menu.category === promo.scopeTarget;
    });
    if (!has) return false;
  }
  if (promo.scope === 'menu' && promo.scopeTarget) {
    const has = ctx.cartItems.some((item) => item.menuId === promo.scopeTarget);
    if (!has) return false;
  }

  // P-A5: min-qty gate (hanya untuk percentage/fixed — BOGO punya threshold sendiri)
  if (promo.type !== 'bogo' && promo.minQty && promo.minQty > 0) {
    if (eligibleItemQty(promo, ctx) < promo.minQty) return false;
  }

  return true;
}

/**
 * Hitung diskon BOGO:
 * 1. Kumpulkan harga satuan item yang cocok scope (diulang per qty).
 * 2. Setiap `buyQty` unit → `freeQty` unit gratis (floor).
 * 3. Gratis diambil dari unit TERMURAH.
 * 4. bogoPercent > 0 → gratis sebagian (persen dari harga unit).
 */
export function calculateBogoDiscount(promo: Promo, ctx: PromoContext): number {
  const buyQty = Math.max(1, Math.floor(promo.bogoBuyQty || 2));
  const freeQty = Math.max(1, Math.floor(promo.bogoFreeQty || 1));
  const percent = Math.min(100, Math.max(0, promo.bogoPercent || 0));

  const prices: number[] = [];
  ctx.cartItems.forEach((item) => {
    const menu = ctx.menus.find((m) => m.id === item.menuId);
    const match =
      promo.scope === 'all'
        ? true
        : promo.scope === 'menu'
        ? item.menuId === promo.scopeTarget
        : promo.scope === 'category'
        ? !!(menu && menu.category === promo.scopeTarget)
        : false; // scope loyalty tidak relevan untuk BOGO (tanpa item)
    if (!match) return;
    for (let i = 0; i < item.quantity; i++) prices.push(unitPrice(item));
  });

  prices.sort((a, b) => a - b); // termurah dulu — gratis = item termurah

  const totalQty = prices.length;
  if (totalQty < buyQty) return 0; // belum memenuhi 1 set

  const sets = Math.floor(totalQty / buyQty);
  const freeUnits = Math.min(sets * freeQty, totalQty);
  if (freeUnits <= 0) return 0;

  let discount = 0;
  for (let i = 0; i < freeUnits; i++) {
    discount += prices[i];
  }
  if (percent > 0) {
    discount = Math.round((discount * (100 - percent)) / 100);
  }
  return discount;
}

/**
 * Hitung diskon promo untuk keranjang. Mengembalikan 0 bila tidak berlaku.
 * - percentage: subtotal * value% (cap maxDiscount)
 * - fixed: nilai tetap
 * - bogo: per item (beli N gratis M / diskon per unit gratis)
 */
export function calculatePromoDiscount(promo: Promo, subtotal: number, ctx: PromoContext): number {
  if (!isPromoApplicable(promo, subtotal, ctx)) return 0;

  if (promo.type === 'bogo') {
    return calculateBogoDiscount(promo, ctx);
  }
  if (promo.type === 'percentage') {
    let discount = Math.round(subtotal * promo.value / 100);
    if (promo.maxDiscount && discount > promo.maxDiscount) discount = promo.maxDiscount;
    return discount;
  }
  // fixed
  return promo.value;
}
