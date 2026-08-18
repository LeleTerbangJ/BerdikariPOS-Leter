/**
 * Refund / Retur Penuh — v4.7 TO DO 11.2 (P0.2)
 *
 * Logika murni untuk refund transaksi Selesai:
 * - Hanya transaksi Selesai, belum di-refund, bukan sub-bill split / induk ber-anak split.
 * - Refund penuh = mengembalikan totalAmount (stok & kunjungan pelanggan ikut di-revert di caller).
 * - Arus kas keluar dicatat sebagai CashMovement tipe 'out' kategori 'Refund' (akuntabel di Rekap Kas).
 */

import { v4 as uuid } from 'uuid';
import type { CashMovement, Transaction } from '../types';

/** Kategori Kas Keluar untuk refund — konsisten di Rekap Kas & laporan. */
export const REFUND_CASH_CATEGORY = 'Refund';

/**
 * Apakah transaksi bisa di-refund.
 * - txStatus Selesai (hanya penjualan yang selesai yang bisa dikembalikan)
 * - belum refunded (anti double-refund)
 * - bukan sub-bill split & bukan induk yang punya anak split (stok dikelola sesi split)
 * - nominal > 0
 */
export function isRefundableTransaction(
  tx: Transaction,
  hasSplitChildren: boolean
): boolean {
  return (
    tx.txStatus === 'Selesai' &&
    tx.refunded !== true &&
    !tx.splitParentId && // defense-in-depth: sub-bill anak tidak pernah di-refund mandiri
    !hasSplitChildren &&
    (tx.totalAmount ?? 0) > 0
  );
}

/** Nominal refund (full refund = totalAmount transaksi). */
export function refundAmount(tx: Transaction): number {
  return Math.max(0, tx.totalAmount ?? 0);
}

/**
 * v4.7 TO DO 18.8 (A4) — Guard EKSEKUSI refund (anti double-refund di level STORE).
 *
 * `isRefundableTransaction` memakai salinan RENDER yang bisa basi (`refunded` belum
 * ter-update di state komponen) — dua klik cepat bisa lolos keduanya → revert stok
 * ganda + 2× Kas Keluar Refund. Helper ini:
 *   1. Cek ulang `refunded` dari daftar transaksi STORE (sumber kebenaran mutasi).
 *   2. Hormati guard in-flight (proteksi reentrancy bila eksekusi jadi async).
 *   3. Kembalikan transaksi TARGET TERBARU (fresh ?? render) bila boleh dieksekusi,
 *      null bila ditolak — caller memakai return ini, bukan salinan render.
 */
export function canExecuteRefund(
  tx: Transaction,
  storeTransactions: Transaction[],
  hasSplitChildren: (t: Transaction) => boolean,
  inFlight = false
): Transaction | null {
  if (inFlight) return null;
  const fresh = storeTransactions.find((t) => t.id === tx.id);
  if (fresh?.refunded) return null;
  const target = fresh ?? tx;
  if (!isRefundableTransaction(target, hasSplitChildren(target))) return null;
  return target;
}

/** Catatan Kas Keluar refund — link ke nomor antrean + alasan opsional. */
export function refundMovementNotes(tx: Transaction, note?: string): string {
  return `Refund transaksi #${tx.queueNumber}${note ? ` — ${note}` : ''}`;
}

/** Kas Keluar 'Refund' yang dicatat di Rekap Kas (akuntabel & link ke transaksi). */
export function buildRefundCashMovement(
  tx: Transaction,
  cashierId: string,
  cashierName: string,
  note?: string
): CashMovement {
  const now = new Date().toISOString();
  const amount = refundAmount(tx);
  return {
    id: uuid(),
    type: 'out',
    amount,
    category: REFUND_CASH_CATEGORY,
    notes: refundMovementNotes(tx, note),
    cashierId,
    cashierName,
    date: now,
    createdAt: now,
  };
}
