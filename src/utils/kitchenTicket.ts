import type { Transaction, CartItem } from '../types';
import type { PrintJobResult } from './printer';

/**
 * v4.7 TO DO 18.8 (A10) — Keputusan cetak tiket dapur berbasis FAKTA, bukan asumsi.
 *
 * Latar belakang: sebelumnya resume pending dengan item TIDAK berubah SELALU melewati
 * cetak tiket dapur dengan asumsi "tiket sudah keluar saat Simpan Pending". Asumsi itu
 * salah bila printer gagal saat itu (BT putus, kertas habis) → tiket hilang diam-diam,
 * dapur tidak pernah menerima pesanan. Sebaliknya bila cetak berhasil dan resume tetap
 * mencetak ulang → tiket DOBEL.
 *
 * Solusi: engine mencatat `kitchenTicketPrintedAt` pada transaksi HANYA bila tiket dapur
 * benar-benar sukses dicetak saat Simpan Pending. Keputusan resume:
 *  - item BERUBAH            → cetak ulang (dapur harus melihat spesifikasi baru).
 *  - item sama & SUDAH cetak  → skip (anti tiket dobel).
 *  - item sama & BELUM cetak  → cetak ulang (tiket tidak boleh hilang).
 */

/** true bila SEMUA job tiket dapur sukses (atau tidak ada printer dapur aktif — tidak ada yang gagal). */
export function didKitchenPrintSucceed(results?: PrintJobResult[]): boolean {
  if (!results || results.length === 0) return true;
  return results.every((r) => r.status === 'success');
}

/** Keputusan skip tiket dapur saat finalize resume pending. */
export function shouldSkipKitchenPrintAtResume(
  pendingTx: Transaction | null | undefined,
  itemsChanged: boolean
): boolean {
  if (!pendingTx) return false;
  if (itemsChanged) return false;
  return !!pendingTx.kitchenTicketPrintedAt;
}

/**
 * Helper untuk membuat signature spesifikasi unik dari sebuah item (menu + suhu + gula + addons).
 * Digunakan untuk mencocokkan item keranjang dengan item pending lintas multi-resume.
 */
export function getItemSpecKey(item: CartItem): string {
  const addons = (item.addons || [])
    .map((a) => `${a.name}:${a.price}`)
    .sort()
    .join(',');
  const bundleTag = item.isBundle ? ':bundle' : item.isBundleChild ? `:bundleChild:${item.parentLineId || ''}` : '';
  return `${item.menuId}|${item.temperature || 'Hangat'}|${item.sugar || 'None'}|${addons}${bundleTag}`;
}

/**
 * v4.8: Cek apakah ada item dapur baru, kuantitas bertambah, atau spesifikasi berubah.
 * Menggunakan signature spesifikasi menu agar akurat pada multi-resume bertahap.
 */
export function hasNewKitchenItems(cartItems: CartItem[], pendingItems: CartItem[]): boolean {
  for (const c of cartItems) {
    const specKey = getItemSpecKey(c);
    const matchingPending = pendingItems.filter((p) => getItemSpecKey(p) === specKey);
    const totalPendingQty = matchingPending.reduce((sum, p) => sum + p.quantity, 0);

    if (totalPendingQty === 0 || c.quantity > totalPendingQty) {
      return true;
    }
  }
  return false;
}

/**
 * v4.8 TO DO 23.1: Cek apakah ada item dengan status 'new' yang perlu diproses dapur.
 */
export function hasNewStatusItems(items: CartItem[]): boolean {
  return items.some((item) => (item.kitchenItemStatus || 'new') === 'new');
}

/**
 * v4.8 TO DO 23.1: Set kitchenItemStatus untuk semua item di cart.
 */
export function setAllItemsKitchenStatus(
  cartItems: CartItem[],
  status: 'new' | 'processing' | 'done'
): CartItem[] {
  return cartItems.map((item) => ({ ...item, kitchenItemStatus: status }));
}

/**
 * v4.8.4: Hitung item dengan status baru + pertahankan status item lama berbasis Signature Spesifikasi Menu.
 * Jika kuantitas bertambah (c.quantity > totalPendingQty), semua porsi lama tetap mempertahankan
 * status aslinya ('done' / 'processing'), dan HANYA selisih porsi tambahan yang diberi status 'new'.
 */
export function mergeKitchenItemStatus(
  cartItems: CartItem[],
  pendingItems: CartItem[]
): CartItem[] {
  const result: CartItem[] = [];

  for (const c of cartItems) {
    const specKey = getItemSpecKey(c);
    const matchingPending = pendingItems.filter((p) => getItemSpecKey(p) === specKey);
    const totalPendingQty = matchingPending.reduce((sum, p) => sum + p.quantity, 0);

    if (totalPendingQty === 0) {
      // Item baru ditambahkan → status 'new'
      result.push({ ...c, kitchenItemStatus: 'new' as const });
    } else if (c.quantity >= totalPendingQty) {
      // Pertahankan seluruh item pending yang sudah ada dengan status masing-masing
      const unitPrice = c.basePrice + (c.addons || []).reduce((a, b) => a + b.price, 0);
      for (const p of matchingPending) {
        result.push({
          ...c,
          lineId: p.lineId,
          quantity: p.quantity,
          subtotal: Math.max(0, unitPrice * p.quantity - (p.itemDiscount || 0)),
          kitchenItemStatus: p.kitchenItemStatus || 'new',
        });
      }

      // Jika kuantitas bertambah di atas total kuantitas lama, buat item delta baru berstatus 'new'
      if (c.quantity > totalPendingQty) {
        const addQty = c.quantity - totalPendingQty;
        result.push({
          ...c,
          lineId: `${c.lineId}-add-${Math.random().toString(36).substring(2, 7)}`,
          quantity: addQty,
          subtotal: Math.max(0, unitPrice * addQty),
          kitchenItemStatus: 'new' as const,
        });
      }
    } else {
      // Kuantitas berkurang (c.quantity < totalPendingQty): alokasikan kuantitas baru ke item lama
      let remainingQty = c.quantity;
      const unitPrice = c.basePrice + (c.addons || []).reduce((a, b) => a + b.price, 0);

      // Prioritaskan mempertahankan item yang sudah 'done' atau 'processing'
      const sortedPending = [...matchingPending].sort((a, b) => {
        const score = (st?: string) => (st === 'done' ? 3 : st === 'processing' ? 2 : 1);
        return score(b.kitchenItemStatus) - score(a.kitchenItemStatus);
      });

      for (const p of sortedPending) {
        if (remainingQty <= 0) break;
        const allocatedQty = Math.min(p.quantity, remainingQty);
        result.push({
          ...c,
          lineId: p.lineId,
          quantity: allocatedQty,
          subtotal: Math.max(0, unitPrice * allocatedQty - (p.itemDiscount || 0)),
          kitchenItemStatus: p.kitchenItemStatus || 'new',
        });
        remainingQty -= allocatedQty;
      }
    }
  }

  return result;
}

/**
 * v4.9 ORDER BATCH: Mendapatkan nomor batch tertinggi dari daftar item.
 */
export function getMaxBatch(items: CartItem[]): number {
  if (!items || items.length === 0) return 1;
  return Math.max(...items.map((i) => i.batch || 1), 1);
}

/**
 * v4.9 ORDER BATCH: Label kloter pesanan (Batch 1 = Pesanan Awal, Batch 2+ = Tambahan).
 */
export function formatBatchLabel(batch: number): string {
  if (batch <= 1) return 'PESANAN AWAL';
  return `TAMBAHAN #${batch - 1}`;
}

/**
 * v4.9 ORDER BATCH: Ambil item-item yang termasuk dalam batch tertentu.
 */
export function getBatchItems(items: CartItem[], targetBatch: number): CartItem[] {
  return items.filter((i) => (i.batch || 1) === targetBatch);
}

/**
 * v4.9 ORDER BATCH: Ambil item-item untuk dicetak ke dapur saat simpan/update pending.
 * Jika ada targetBatch eksplisit (> 1), ambil item kloter tersebut.
 * Jika tidak, ambil item dengan status 'new' atau delta items.
 */
export function getNewBatchOrStatusItems(items: CartItem[], targetBatch?: number): CartItem[] {
  if (targetBatch && targetBatch > 1) {
    const batchItems = getBatchItems(items, targetBatch);
    if (batchItems.length > 0) return batchItems;
  }
  return items.filter((i) => (i.kitchenItemStatus || 'new') === 'new');
}

/**
 * v4.8.4 & v4.9: Hitung porsi delta baru/tambahan yang perlu dikirim ke printer dapur berbasis Signature Spesifikasi Menu.
 * Hanya porsi selisih baru di atas total porsi lama yang dikirim sebagai tiket tambahan.
 */
export function calculateDeltaKitchenItems(cartItems: CartItem[], pendingItems: CartItem[]): CartItem[] {
  const delta: CartItem[] = [];

  for (const c of cartItems) {
    const specKey = getItemSpecKey(c);
    const matchingPending = pendingItems.filter((p) => getItemSpecKey(p) === specKey);
    const totalPendingQty = matchingPending.reduce((sum, p) => sum + p.quantity, 0);

    if (totalPendingQty === 0) {
      // Item baru → kirim seluruh kuantitas dengan status 'new'
      delta.push({ ...c, kitchenItemStatus: 'new' });
    } else if (c.quantity > totalPendingQty) {
      // Kuantitas bertambah → kirim HANYA selisih porsi tambahan
      const addQty = c.quantity - totalPendingQty;
      const unitPrice = c.basePrice + (c.addons || []).reduce((a, b) => a + b.price, 0);
      delta.push({
        ...c,
        lineId: `${c.lineId}-add-${Math.random().toString(36).substring(2, 7)}`,
        quantity: addQty,
        subtotal: Math.max(0, unitPrice * addQty),
        kitchenItemStatus: 'new',
      });
    }
  }

  return delta;
}



