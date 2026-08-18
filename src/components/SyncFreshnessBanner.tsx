import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTransactionStore } from '../store/transactionStore';
import { getQueueLength } from '../lib/offlineQueue';

/**
 * v4.7 TO DO 18.6 — Indikator "Laporan belum final".
 *
 * Konteks: aplikasi local-first — sebelum sinkron selesai, laporan di device ini belum
 * memuat penjualan device lain, dan transaksi lokal yang belum tersinkron belum tentu
 * masuk angka final. Indikator ini memberi tahu pengguna bahwa angka di bawah bisa
 * berubah setelah sinkron selesai (reuse badge O-5 / `confirmedSyncIds`).
 *
 * Catatan desain: antrean offline memakai SATU slot listener global (Layout/O-4 memegangnya),
 * jadi komponen ini TIDAK memakai setQueueChangeListener (akan saling menimpa). Jumlah
 * operasi antrean dibaca saat mount + interval 30 dtk + saat tab kembali terlihat —
 * cukup untuk petunjuk freshness (bukan badge realtime per detik).
 */

const QUEUE_POLL_MS = 30000;

/**
 * Logika murni banner — mudah diuji tanpa render React.
 * `unsyncedTx` = transaksi lokal yang belum terkonfirmasi tersinkron (badge O-5).
 */
export function computeSyncFreshness(
  transactions: { id: string }[],
  confirmedSyncIds: string[],
  queueOps: number
): { unsyncedTx: number; show: boolean } {
  const unsyncedTx = transactions.filter((t) => !confirmedSyncIds.includes(t.id)).length;
  return { unsyncedTx, show: unsyncedTx > 0 || queueOps > 0 };
}

export default function SyncFreshnessBanner() {
  const transactions = useTransactionStore((s) => s.transactions);
  const confirmedSyncIds = useTransactionStore((s) => s.confirmedSyncIds);
  const [queueOps, setQueueOps] = useState(() => getQueueLength());

  useEffect(() => {
    setQueueOps(getQueueLength());

    const poll = () => setQueueOps(getQueueLength());
    const interval = setInterval(poll, QUEUE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', poll);
    };
  }, []);

  // Transaksi lokal yang belum terkonfirmasi tersinkron ke cloud (mekanisme badge O-5)
  const { unsyncedTx, show } = computeSyncFreshness(transactions, confirmedSyncIds, queueOps);

  if (!show) return null;

  const queueSuffix = queueOps > 0 ? ` (+${queueOps} operasi lain dalam antrean sinkron)` : '';

  return (
    <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-xs sm:text-sm">
      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
      <p>
        <strong>Laporan belum final</strong> —{' '}
        {unsyncedTx > 0
          ? `${unsyncedTx} transaksi belum tersinkron ke cloud`
          : 'Masih ada operasi menunggu sinkron'}
        {queueSuffix}. Angka di bawah dapat berubah setelah sinkron selesai.
      </p>
    </div>
  );
}
