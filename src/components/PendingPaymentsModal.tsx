import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { useTransactionStore, isPendingTransaction } from '../store/transactionStore';
import { useSettingsStore } from '../store/settingsStore';
import { useToastStore } from '../store/toastStore';
import { formatRupiah, formatTime } from '../utils/format';
import { printProvisionalBill } from '../utils/printer';
// v4.7 TO DO 18.2 (Prioritas 18): badge "#N duplikat" — deteksi nomor antrean kembar lintas device
import { findDuplicateQueueNumbers } from '../utils/queueNumber';
import type { Transaction } from '../types';
import { Search, Clock, Printer, Trash2, ArrowRight, ChevronLeft, ChevronRight, Ban } from 'lucide-react';

interface PendingPaymentsModalProps {
  open: boolean;
  onClose: () => void;
  onResumeOrder: (tx: Transaction) => void;
}

export default function PendingPaymentsModal({
  open,
  onClose,
  onResumeOrder,
}: PendingPaymentsModalProps) {
  // v4.1 TO DO 3.2: selector stabil s.transactions (referensi berubah hanya saat array diganti)
  // + useMemo filter — getPendingTransactions() dipanggil langsung saat render tidak reactive.
  const allTransactions = useTransactionStore((s) => s.transactions);
  const cancelPendingTransaction = useTransactionStore((s) => s.cancelPendingTransaction);
  const { settings } = useSettingsStore();
  const { addToast } = useToastStore();
  const [search, setSearch] = useState('');
  // v4.7 TO DO 20.3: void pending via ConfirmDialog (bukan window.confirm)
  const [voidTarget, setVoidTarget] = useState<Transaction | null>(null);

  const pendingList = useMemo(() => allTransactions.filter(isPendingTransaction), [allTransactions]);
  // v4.7 TO DO 18.2: nomor antrean yang muncul > 1× di hari yang sama (kemungkinan 2 kasir offline)
  const dupQueueNumbers = useMemo(
    () => findDuplicateQueueNumbers(allTransactions),
    [allTransactions]
  );

  const filteredList = pendingList.filter((t) => {
    const qStr = `#${t.queueNumber}`;
    const nameStr = (t.customerName || '').toLowerCase();
    const tableStr = (t.tableName || t.tableNumber || '').toLowerCase();
    const s = search.toLowerCase();
    return qStr.includes(s) || nameStr.includes(s) || tableStr.includes(s);
  });

  // v4.7 TO DO 15.2: daftar pending jadi CAROUSEL horizontal — index aktif di filteredList
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const safeIdx = filteredList.length === 0 ? 0 : Math.min(activeIdx, filteredList.length - 1);
  const currentTx = filteredList[safeIdx] || null;

  // Sinkron scroll position saat daftar berubah (pencarian / void menghapus item)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || filteredList.length === 0) return;
    const desiredLeft = Math.min(safeIdx, filteredList.length - 1) * el.clientWidth;
    if (Math.abs(el.scrollLeft - desiredLeft) > 2) {
      el.scrollTo({ left: desiredLeft });
    }
  }, [filteredList.length]);

  // Sinkron activeIdx dari posisi scroll (geser jari / scroll-snap)
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIdx(Math.max(0, Math.min(idx, filteredList.length - 1)));
  }, [filteredList.length]);

  const scrollToIndex = useCallback(
    (idx: number) => {
      const el = scrollRef.current;
      if (!el || filteredList.length === 0) return;
      const target = Math.max(0, Math.min(idx, filteredList.length - 1));
      el.scrollTo({ left: target * el.clientWidth, behavior: 'smooth' });
      setActiveIdx(target);
    },
    [filteredList.length]
  );

  const handlePrintBill = (tx: Transaction) => {
    printProvisionalBill(tx, settings);
    addToast(`Struk sementara #${tx.queueNumber} dikirim ke printer.`, 'info');
  };

  const handleVoid = (tx: Transaction) => {
    // v4.7 TO DO 20.3: window.confirm → ConfirmDialog
    setVoidTarget(tx);
  };

  return (
    <Modal open={open} onClose={onClose} title="Pending Payments" maxWidth="max-w-4xl">
      <div className="flex flex-col md:flex-row gap-4 h-[520px]">
        {/* Left: Pending Orders Carousel */}
        <div className="w-full md:w-5/12 flex flex-col border-r border-slate-100 dark:border-slate-700/50 pr-0 md:pr-4">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari meja, antrean, nama..."
              className="input pl-9 text-xs py-2"
            />
          </div>

          {filteredList.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
              <Clock className="mb-2 opacity-50" size={32} />
              <p className="text-sm">Tidak ada pesanan gantung</p>
            </div>
          ) : (
            <>
              {/* Carousel: card bergeser kiri/kanan (scroll-snap + dukungan sentuh) */}
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex-1 flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {filteredList.map((tx, idx) => {
                  const tableInfo = tx.tableName || tx.tableNumber;
                  const isActive = idx === safeIdx;
                  return (
                    <div
                      key={tx.id}
                      className={`w-full shrink-0 snap-center flex flex-col justify-between p-4 rounded-xl border transition cursor-pointer ${
                        isActive
                          ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                      onClick={() => scrollToIndex(idx)}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-brand-600 dark:text-brand-400 text-sm flex items-center gap-1.5">
                            #{tx.queueNumber}
                            {dupQueueNumbers.has(tx.queueNumber) && (
                              <span
                                className="text-[9px] bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 font-bold px-1.5 py-0.5 rounded-full"
                                title="Nomor antrean ini muncul lebih dari satu kali hari ini (kemungkinan dua kasir memproses bersamaan saat offline)"
                              >
                                <Ban size={9} className="inline" /> duplikat
                              </span>
                            )}
                          </span>
                          <span className="text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-semibold px-2 py-0.5 rounded-full">
                            Pending
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 mb-1.5">
                          <span className="font-medium truncate max-w-[140px]">
                            {tx.customerName || 'Pelanggan'} {tableInfo ? `(${tableInfo})` : ''}
                          </span>
                          <span>{formatTime(tx.date)}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100 dark:border-slate-700/50">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400">{tx.items.length} Menu</span>
                          {/* v4.7 TO DO 21.4: badge 'Diupdate' jika pending sudah diedit (updatedAt > date + 5 detik) */}
                          {tx.updatedAt && new Date(tx.updatedAt).getTime() - new Date(tx.date).getTime() > 5000 && (
                            <span className="text-[9px] bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 font-semibold px-1.5 py-0.5 rounded-full">
                              ✓ Diupdate
                            </span>
                          )}
                        </div>
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {formatRupiah(tx.totalAmount)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Navigasi carousel: panah + dot + counter */}
              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={() => scrollToIndex(safeIdx - 1)}
                  disabled={safeIdx <= 0}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title="Pesanan sebelumnya"
                >
                  <ChevronLeft size={16} />
                </button>

                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1.5">
                    {filteredList.map((tx, idx) => (
                      <button
                        key={tx.id}
                        onClick={() => scrollToIndex(idx)}
                        className={`h-1.5 rounded-full transition-all ${idx === safeIdx ? 'w-4 bg-brand-500' : 'w-1.5 bg-slate-300 dark:bg-slate-600'}`}
                        title={`Pesanan #${tx.queueNumber}`}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {safeIdx + 1} dari {filteredList.length} pesanan gantung
                  </span>
                </div>

                <button
                  onClick={() => scrollToIndex(safeIdx + 1)}
                  disabled={safeIdx >= filteredList.length - 1}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title="Pesanan berikutnya"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Right: Selected Order Detail */}
        {currentTx ? (
          <div className="w-full md:w-7/12 flex flex-col justify-between pl-0 md:pl-2">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700/50">
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <span>Order #{currentTx.queueNumber}</span>
                    {(currentTx.tableName || currentTx.tableNumber) && (
                      <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-2 py-0.5 rounded-md">
                        {currentTx.tableName || currentTx.tableNumber}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Pemesan: {currentTx.customerName || 'Pelanggan'} • {formatTime(currentTx.date)}
                  </p>
                </div>

                <button
                  onClick={() => handlePrintBill(currentTx)}
                  className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                  title="Cetak Struk Tagihan Sementara"
                >
                  <Printer size={14} /> Struk Sementara
                </button>
              </div>

              {/* Items List */}
              <div className="max-h-60 overflow-y-auto py-3 space-y-2">
                {currentTx.items.map((item) => (
                  <div key={item.lineId} className="flex justify-between items-start text-xs border-b border-slate-50 dark:border-slate-800 pb-1.5">
                    <div>
                      <p className="font-medium text-slate-800 dark:text-slate-200">
                        {item.name} x{item.quantity}
                      </p>
                      {item.addons && item.addons.length > 0 && (
                        <p className="text-[10px] text-slate-400">
                          + {item.addons.map((a) => a.name).join(', ')}
                        </p>
                      )}
                    </div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {formatRupiah(item.subtotal)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl space-y-1 text-xs">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal</span>
                  <span>{formatRupiah(currentTx.subtotal)}</span>
                </div>
                {currentTx.discount > 0 && (
                  <div className="flex justify-between text-green-600 dark:text-green-400">
                    <span>Diskon</span>
                    <span>-{formatRupiah(currentTx.discount)}</span>
                  </div>
                )}
                {currentTx.tax ? (
                  <div className="flex justify-between text-slate-500">
                    <span>Pajak</span>
                    <span>+{formatRupiah(currentTx.tax)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100 text-sm pt-1 border-t border-slate-200 dark:border-slate-700">
                  <span>Total Tagihan</span>
                  <span className="text-brand-600 dark:text-brand-400">{formatRupiah(currentTx.totalAmount)}</span>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-700/50">
              <button
                onClick={() => handleVoid(currentTx)}
                className="px-3 py-2 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition flex items-center gap-1 font-medium"
              >
                <Trash2 size={14} /> Batalkan
              </button>
              <button
                onClick={() => {
                  onResumeOrder(currentTx);
                  onClose();
                }}
                className="btn-primary flex-1 text-sm py-2.5 flex items-center justify-center gap-2"
              >
                <span>Lanjutkan Pembayaran</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full md:w-7/12 flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs">
            Pilih pesanan di sebelah kiri untuk melihat detail
          </div>
        )}
      </div>

      {/* v4.7 TO DO 20.3: konfirmasi void pending (bukan window.confirm) */}
      <ConfirmDialog
        open={!!voidTarget}
        onClose={() => setVoidTarget(null)}
        onConfirm={() => {
          if (voidTarget) {
            cancelPendingTransaction(voidTarget.id);
            addToast(`Transaksi pending #${voidTarget.queueNumber} berhasil dibatalkan.`, 'success');
          }
        }}
        title="Batalkan Transaksi Gantung"
        message={`Yakin ingin membatalkan transaksi gantung #${voidTarget?.queueNumber ?? ''}? Stok bahan baku akan dikembalikan.`}
        confirmText="Ya, Batalkan"
      />
    </Modal>
  );
}
