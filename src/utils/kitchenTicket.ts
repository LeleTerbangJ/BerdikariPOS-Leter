import type { Transaction } from '../types';
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
