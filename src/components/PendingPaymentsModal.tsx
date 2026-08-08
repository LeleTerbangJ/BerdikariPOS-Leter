import { useState, useMemo } from 'react';
import Modal from './Modal';
import { useTransactionStore, isPendingTransaction } from '../store/transactionStore';
import { useSettingsStore } from '../store/settingsStore';
import { useToastStore } from '../store/toastStore';
import { formatRupiah, formatTime } from '../utils/format';
import { printProvisionalBill } from '../utils/printer';
import type { Transaction } from '../types';
import { Search, Clock, Printer, Trash2, ArrowRight, UtensilsCrossed, FileText } from 'lucide-react';

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
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  const pendingList = useMemo(() => allTransactions.filter(isPendingTransaction), [allTransactions]);

  const filteredList = pendingList.filter((t) => {
    const qStr = `#${t.queueNumber}`;
    const nameStr = (t.customerName || '').toLowerCase();
    const tableStr = (t.tableName || t.tableNumber || '').toLowerCase();
    const s = search.toLowerCase();
    return qStr.includes(s) || nameStr.includes(s) || tableStr.includes(s);
  });

  const selectedTx = pendingList.find((t) => t.id === selectedTxId) || filteredList[0] || null;

  const handlePrintBill = (tx: Transaction) => {
    printProvisionalBill(tx, settings);
    addToast(`Struk sementara #${tx.queueNumber} dikirim ke printer.`, 'info');
  };

  const handleVoid = (tx: Transaction) => {
    if (window.confirm(`⚠️ Yakin ingin membatalkan transaksi gantung #${tx.queueNumber}? Stok bahan baku akan dikembalikan.`)) {
      cancelPendingTransaction(tx.id);
      addToast(`Transaksi pending #${tx.queueNumber} berhasil dibatalkan.`, 'success');
      if (selectedTxId === tx.id) setSelectedTxId(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Pending Payments" maxWidth="max-w-4xl">
      <div className="flex flex-col md:flex-row gap-4 h-[520px]">
        {/* Left: Pending Orders List */}
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

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {filteredList.length === 0 ? (
              <div className="text-center py-10 text-slate-400 dark:text-slate-500">
                <Clock className="mx-auto mb-2 opacity-50" size={32} />
                <p className="text-sm">Tidak ada pesanan gantung</p>
              </div>
            ) : (
              filteredList.map((tx) => {
                const isSelected = selectedTx?.id === tx.id;
                const tableInfo = tx.tableName || tx.tableNumber;
                return (
                  <button
                    key={tx.id}
                    onClick={() => setSelectedTxId(tx.id)}
                    className={`w-full text-left p-3 rounded-xl border transition ${isSelected
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-brand-600 dark:text-brand-400 text-sm">
                        #{tx.queueNumber}
                      </span>
                      <span className="text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-semibold px-2 py-0.5 rounded-full">
                        Pending
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 mb-1">
                      <span className="font-medium truncate max-w-[140px]">
                        {tx.customerName || 'Pelanggan'} {tableInfo ? `(${tableInfo})` : ''}
                      </span>
                      <span>{formatTime(tx.date)}</span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-700/50">
                      <span className="text-slate-400">{tx.items.length} Menu</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {formatRupiah(tx.totalAmount)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Selected Order Detail */}
        {selectedTx ? (
          <div className="w-full md:w-7/12 flex flex-col justify-between pl-0 md:pl-2">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700/50">
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <span>Order #{selectedTx.queueNumber}</span>
                    {(selectedTx.tableName || selectedTx.tableNumber) && (
                      <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-2 py-0.5 rounded-md">
                        {selectedTx.tableName || selectedTx.tableNumber}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Pemesan: {selectedTx.customerName || 'Pelanggan'} • {formatTime(selectedTx.date)}
                  </p>
                </div>

                <button
                  onClick={() => handlePrintBill(selectedTx)}
                  className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                  title="Cetak Struk Tagihan Sementara"
                >
                  <Printer size={14} /> Struk Sementara
                </button>
              </div>

              {/* Items List */}
              <div className="max-h-60 overflow-y-auto py-3 space-y-2">
                {selectedTx.items.map((item) => (
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
                  <span>{formatRupiah(selectedTx.subtotal)}</span>
                </div>
                {selectedTx.discount > 0 && (
                  <div className="flex justify-between text-green-600 dark:text-green-400">
                    <span>Diskon</span>
                    <span>-{formatRupiah(selectedTx.discount)}</span>
                  </div>
                )}
                {selectedTx.tax ? (
                  <div className="flex justify-between text-slate-500">
                    <span>Pajak</span>
                    <span>+{formatRupiah(selectedTx.tax)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100 text-sm pt-1 border-t border-slate-200 dark:border-slate-700">
                  <span>Total Tagihan</span>
                  <span className="text-brand-600 dark:text-brand-400">{formatRupiah(selectedTx.totalAmount)}</span>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-700/50">
              <button
                onClick={() => handleVoid(selectedTx)}
                className="px-3 py-2 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition flex items-center gap-1 font-medium"
              >
                <Trash2 size={14} /> Batalkan
              </button>
              <button
                onClick={() => {
                  onResumeOrder(selectedTx);
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
    </Modal>
  );
}
