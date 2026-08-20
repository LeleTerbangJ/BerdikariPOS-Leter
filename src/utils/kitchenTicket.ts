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
 * v4.8: Cek apakah ada item dapur baru, kuantitas bertambah, atau spesifikasi berubah.
 * Pengurangan item atau kuantitas berkurang tidak dianggap "item baru yang perlu dimasak".
 */
export function hasNewKitchenItems(cartItems: CartItem[], pendingItems: CartItem[]): boolean {
  for (const c of cartItems) {
    const p = pendingItems.find((item) => item.lineId === c.lineId);
    if (!p) {
      return true; // Item baru ditambahkan
    }
    if (c.quantity > p.quantity) {
      return true; // Kuantitas bertambah
    }
    if (c.temperature !== p.temperature || c.sugar !== p.sugar) {
      return true; // Spesifikasi suhu/gula berubah
    }
    // Cek perbedaan addons
    const cAddons = c.addons.map((a) => `${a.name}:${a.price}`).sort().join(',');
    const pAddons = p.addons.map((a) => `${a.name}:${a.price}`).sort().join(',');
    if (cAddons !== pAddons) {
      return true; // Addon berubah
    }
  }
  return false;
}

/**
 * v4.8: Hitung porsi delta baru/tambahan yang perlu dikirim ke printer dapur.
 * Item baru, kuantitas bertambah (selisih kuantitas), dan spesifikasi berubah dikirim.
 */
export function calculateDeltaKitchenItems(cartItems: CartItem[], pendingItems: CartItem[]): CartItem[] {
  const delta: CartItem[] = [];
  for (const c of cartItems) {
    const p = pendingItems.find((item) => item.lineId === c.lineId);
    if (!p) {
      delta.push(c);
    } else {
      const cAddons = c.addons.map((a) => `${a.name}:${a.price}`).sort().join(',');
      const pAddons = p.addons.map((a) => `${a.name}:${a.price}`).sort().join(',');
      const specsChanged = c.temperature !== p.temperature || c.sugar !== p.sugar || cAddons !== pAddons;

      if (specsChanged) {
        delta.push(c);
      } else if (c.quantity > p.quantity) {
        delta.push({
          ...c,
          quantity: c.quantity - p.quantity,
        });
      }
    }
  }
  return delta;
}
