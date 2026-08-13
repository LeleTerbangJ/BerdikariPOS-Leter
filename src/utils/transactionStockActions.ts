/**
 * Transaction Stock Actions — v4.7 (TO DO 8.1 & 8.2)
 *
 * Logika MURNI untuk efek stok & kunjungan pelanggan saat status transaksi berubah
 * atau transaksi dihapus. Dipakai oleh `onConfirmAction` & `onPinSuccess` di
 * Transactions.tsx (sebelumnya dua rantai if-else identik — rawan celah seperti 8.1/8.2).
 *
 * Aturan (dari → ke):
 * - Selesai → Cancel/Demo : revert stok (+ revert kunjungan) — bukan penjualan lagi
 * - Pending → Cancel/Demo : revert stok reserve (dipotong saat pending dibuat)
 * - Cancel/Demo → Selesai : DEDUCT stok (+ record kunjungan) — re-enable penjualan
 *   (TO DO 8.1: sebelumnya hanya Cancel → Selesai yang deduct; Demo → Selesai bocor)
 * - Hapus Selesai : revert stok (+ revert kunjungan)
 * - Hapus Pending : revert stok reserve (TO DO 8.2: sebelumnya bocor)
 * - Hapus Cancel/Demo : tidak ada efek (stok sudah dikembalikan saat transisi)
 * - Pending → Selesai : tidak ada efek (reserve sudah terpotong saat pending dibuat)
 * - isSplit (anak / induk ber-anak split) : TIDAK ADA efek — stok dikelola sesi split
 */

import type { Transaction } from '../types';

export type StockEffectStatus = 'Selesai' | 'Cancel' | 'Pending' | 'Demo' | 'DELETE';

/** Aksi yang di-inject pemanggil (store inventory/customer) — helper tetap murni & mudah diuji. */
export interface TransactionStockActions {
  revertStock: (deductions: Record<string, number>, reason?: string) => void;
  deductStock: (deductions: Record<string, number>, reason?: string) => void;
  revertVisit: (customerId: string, amount: number) => void;
  recordVisit: (customerId: string, amount: number) => void;
}

export interface StockEffectTarget {
  txStatus: Transaction['txStatus'];
  customerId?: string;
  totalAmount: number;
  queueNumber?: number;
  // v4.7 TO DO 11.2 (P0.2): transaksi yang sudah di-refund — stok & kunjungan sudah
  // dikembalikan saat refund, jadi Cancel/Demo/Delete TIDAK boleh revert lagi (double revert).
  refunded?: boolean;
}

export function applyStatusStockEffects(
  target: StockEffectTarget,
  toStatus: StockEffectStatus,
  isSplit: boolean,
  calculateDeductions: () => Record<string, number>,
  actions: TransactionStockActions
): void {
  // Stok transaksi split dikelola sesi split (reserve penuh di sub-bill pertama) — jangan sentuh.
  if (isSplit) return;
  // P0.2: transaksi refunded sudah di-revert stok & kunjungan saat refund — jangan revert ganda.
  if (target.refunded) return;

  const from = target.txStatus;
  const q = target.queueNumber ?? '?';

  if (toStatus === 'DELETE') {
    if (from === 'Selesai') {
      actions.revertStock(calculateDeductions(), `Revert: Hapus transaksi #${q}`);
      if (target.customerId) actions.revertVisit(target.customerId, target.totalAmount);
    } else if (from === 'Pending') {
      // TO DO 8.2: pending belum pernah di-revert — kembalikan stok reserve
      actions.revertStock(calculateDeductions(), `Revert: Hapus pesanan gantung #${q}`);
    }
    // Cancel/Demo sudah di-revert saat transisi sebelumnya — tidak ada efek ganda.
    return;
  }

  if (from === 'Selesai' && (toStatus === 'Cancel' || toStatus === 'Demo')) {
    actions.revertStock(calculateDeductions(), `Revert: ${toStatus === 'Cancel' ? 'Cancel transaksi' : 'Ubah transaksi'} #${q}${toStatus === 'Demo' ? ' menjadi Demo' : ''}`);
    if (target.customerId) actions.revertVisit(target.customerId, target.totalAmount);
  } else if (from === 'Pending' && (toStatus === 'Cancel' || toStatus === 'Demo')) {
    actions.revertStock(calculateDeductions(), `Revert: ${toStatus === 'Cancel' ? 'Cancel pesanan gantung' : 'Ubah pesanan gantung'} #${q}${toStatus === 'Demo' ? ' menjadi Demo' : ''}`);
  } else if ((from === 'Cancel' || from === 'Demo') && toStatus === 'Selesai') {
    // TO DO 8.1: re-enable Demo → Selesai ikut deduct stok + record kunjungan (pola BUG-K3)
    actions.deductStock(calculateDeductions(), `Deduct: Re-enable transaksi #${q}`);
    if (target.customerId) actions.recordVisit(target.customerId, target.totalAmount);
  }
  // Kombinasi lain (Pending → Selesai, dll.) tidak menyentuh stok — reserve sudah terpotong.
}
