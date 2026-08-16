import type { CartItem, Transaction } from '../types';
import type { ResumeContext } from '../store/cartStore';

export interface ResumeRestoreResult {
  /** Transaksi pending yang sah untuk di-restore sebagai currentPendingTx (null = jangan restore). */
  tx: Transaction | null;
  /** true = konteks resume TIDAK lagi valid (pending sudah dibayar/dibatalkan) → harus dibersihkan. */
  stale: boolean;
}

const isPendingTx = (t: Transaction): boolean =>
  t.txStatus === 'Pending' || t.isPending === true;

/**
 * v4.7 TO DO 17.3 — Resolusi restore konteks resume pending setelah POS di-mount ulang.
 *
 * Latar: identitas pending (currentPendingTx + checkoutTxId) adalah component state POS yang
 * hilang saat pindah halaman / refresh, sementara cartStore PERSIST → item hasil resume tetap
 * ada. Tanpa restore, finalize memakai UUID baru → transaksi DUPLIKAT (pending lama masih
 * Pending + transaksi Selesai baru). Helper ini memutuskan apakah konteks resume tersimpan
 * (resumeContext di cartStore) masih sah untuk di-restore.
 *
 * Aturan:
 * - Tanpa konteks → jangan restore (bukan stale).
 * - Konteks ada tapi tx tidak ditemukan / sudah tidak Pending (dibayar atau dibatalkan
 *   di perangkat lain) → STALE (bersihkan konteks agar tidak dipakai ulang).
 * - Konteks ada, tx masih Pending, tapi keranjang KOSONG → jangan restore (resume dibatalkan),
 *   bukan stale (biarkan — tidak merugikan).
 * - Konteks ada, tx masih Pending, keranjang berisi → restore tx tersebut.
 */
export function resolveResumeRestore(
  ctx: ResumeContext | null,
  cartItems: CartItem[],
  transactions: Transaction[]
): ResumeRestoreResult {
  if (!ctx) return { tx: null, stale: false };
  const tx = transactions.find((t) => t.id === ctx.id);
  if (!tx || !isPendingTx(tx)) return { tx: null, stale: true };
  if (cartItems.length === 0) return { tx: null, stale: false };
  return { tx, stale: false };
}
