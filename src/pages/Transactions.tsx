import { useState, useEffect, useMemo } from 'react';
import { useTransactionStore, isPendingTransaction } from '../store/transactionStore';
import { useAuthStore } from '../store/authStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { useMenuStore } from '../store/menuStore';
import { useInventoryStore } from '../store/inventoryStore';
import { useCustomerStore } from '../store/customerStore';
import { useSettingsStore } from '../store/settingsStore';
import { useToastStore } from '../store/toastStore';
import { subscribeToTransactions, unsubscribeChannel, fetchTransactionsFromCloud } from '../lib/cloudSync';
import { isSupabaseConfigured } from '../lib/supabase';
import { formatRupiah, formatDate } from '../utils/format';
import { calculateItemDeductions } from '../utils/hpp';
import { printReceipt, buildReceiptFromTransaction } from '../utils/printer';
import type { TxStatus, Transaction } from '../types';
import PinModal from '../components/PinModal';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import {
  ChevronDown,
  ChevronUp,
  Trash2,
  Ban,
  CheckCircle2,
  FlaskConical,
  Search,
  Calendar,
  Filter,
  DollarSign,
  FileText,
  X,
  ChevronLeft,
  ChevronRight,
  Printer,
  Clock,
} from 'lucide-react';

type DateFilterType = 'today' | 'week' | 'month' | 'all' | 'custom';

export default function Transactions() {
  const { transactions, updateTxStatus, deleteTransaction, loadFromCloud } = useTransactionStore();
  const { currentUser } = useAuthStore();
  const { addLog } = useAuditLogStore();
  const { menus } = useMenuStore();
  const { revertStock, deductStock } = useInventoryStore();
  const { recordVisit, revertVisit } = useCustomerStore();
  const { settings } = useSettingsStore();
  const { addToast } = useToastStore();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [pinAction, setPinAction] = useState<{ type: 'status' | 'delete'; id: string; status?: TxStatus } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'status' | 'delete'; id: string; status?: TxStatus; queueNumber?: number } | null>(null);
  const [reprintTx, setReprintTx] = useState<Transaction | null>(null);

  // BUG-03 fix: Date range, search, status filters & pagination
  const [dateFilter, setDateFilter] = useState<DateFilterType>('today');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TxStatus>('all');
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);

  // Real-time sync: subscribe to transaction changes from other devices
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const channel = subscribeToTransactions(() => {
      fetchTransactionsFromCloud().then((cloudTx) => {
        if (cloudTx) loadFromCloud(cloudTx, true); // fullSync: cloud is authoritative
      });
    });

    return () => { if (channel) unsubscribeChannel(channel); };
  }, []);

  // BUG-03 fix: Filter transactions dynamically based on Date Filter, Status Filter & Search Query
  const filteredTx = useMemo(() => {
    const now = new Date();

    return transactions.filter((t) => {
      // 1. Status Filter
      if (statusFilter !== 'all' && t.txStatus !== statusFilter) return false;

      // 2. Date Filter
      const d = new Date(t.date);
      let matchDate = true;
      switch (dateFilter) {
        case 'today': {
          matchDate =
            d.getFullYear() === now.getFullYear() &&
            d.getMonth() === now.getMonth() &&
            d.getDate() === now.getDate();
          break;
        }
        case 'week': {
          const weekAgo = new Date(now);
          weekAgo.setDate(weekAgo.getDate() - 7);
          matchDate = d >= weekAgo;
          break;
        }
        case 'month': {
          matchDate =
            d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
          break;
        }
        case 'custom': {
          const from = customDateFrom ? new Date(customDateFrom) : new Date(0);
          const to = customDateTo ? new Date(customDateTo + 'T23:59:59') : new Date();
          matchDate = d >= from && d <= to;
          break;
        }
        case 'all':
        default:
          matchDate = true;
      }
      if (!matchDate) return false;

      // 3. Search Filter (Queue number, Customer, Cashier, OrderType, TableNumber, PaymentMethod)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const queueStr = `#${t.queueNumber}`;
        const matchQueue = queueStr.toLowerCase().includes(q) || String(t.queueNumber) === q;
        const matchCashier = t.cashierName?.toLowerCase().includes(q);
        const matchCustomer = t.customerName?.toLowerCase().includes(q);
        const matchOrderType = t.orderType?.toLowerCase().includes(q);
        const matchTable = t.tableNumber?.toLowerCase().includes(q);
        const matchPay = t.paymentMethod?.toLowerCase().includes(q);
        const matchItem = t.items.some((i) => i.name.toLowerCase().includes(q));

        return matchQueue || matchCashier || matchCustomer || matchOrderType || matchTable || matchPay || matchItem;
      }

      return true;
    });
  }, [transactions, dateFilter, customDateFrom, customDateTo, searchQuery, statusFilter]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredTx.length / perPage) || 1;
  const paginatedTx = useMemo(() => {
    const start = (page - 1) * perPage;
    return filteredTx.slice(start, start + perPage);
  }, [filteredTx, page, perPage]);

  // Summary statistics for active filtered view
  const stats = useMemo(() => {
    // v4.1 TO DO 1.6: Sub-bill hasil split (anak) tidak dihitung omset — sudah tercatat di transaksi induk (parent)
    const completed = filteredTx.filter((t) => t.txStatus === 'Selesai' && !t.splitParentId);
    const totalOmset = completed.reduce((a, t) => a + t.totalAmount, 0);
    const cancelCount = filteredTx.filter((t) => t.txStatus === 'Cancel').length;
    // Predicate sama dengan isPendingTransaction() di store agar angka konsisten
    const pendingCount = filteredTx.filter(isPendingTransaction).length;
    return {
      totalCount: filteredTx.length,
      completedCount: completed.length,
      cancelCount,
      pendingCount,
      totalOmset,
    };
  }, [filteredTx]);

  const handleStatusChange = (id: string, status: TxStatus, queueNumber?: number) => {
    if (currentUser?.role === 'Manager') {
      setConfirmAction({ type: 'status', id, status, queueNumber });
    } else {
      setPinAction({ type: 'status', id, status });
    }
  };

  const handleDelete = (id: string, queueNumber?: number) => {
    if (currentUser?.role === 'Manager') {
      setConfirmAction({ type: 'delete', id, queueNumber });
    } else {
      setPinAction({ type: 'delete', id });
    }
  };

  // BUG-04 & BUG-K3 fix: Shared calculateItemDeductions (includes addon ingredients)
  const calculateDeductions = (tx: Transaction): Record<string, number> => {
    return calculateItemDeductions(tx.items, menus);
  };

  // v4.1 TO DO 1.6: Transaksi anak hasil split bill, atau transaksi induk yang memiliki anak split,
  // tidak boleh di-revert/deduct stok otomatis — stok dikelola sesi split (reserve penuh di sub-bill pertama).
  const hasSplitChildren = (tx: Transaction): boolean =>
    !!tx.splitParentId || transactions.some((t) => t.splitParentId === tx.id);

  // Execute after Manager confirms
  const onConfirmAction = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'status' && confirmAction.status) {
      const tx = transactions.find((t) => t.id === confirmAction.id);
      if (tx) {
        if (confirmAction.status === 'Cancel' && tx.txStatus === 'Selesai') {
          if (!hasSplitChildren(tx)) {
            const deductions = calculateDeductions(tx);
            revertStock(deductions, `Revert: Cancel transaksi #${tx.queueNumber}`);
            if (tx.customerId) {
              revertVisit(tx.customerId, tx.totalAmount);
            }
          }
        } else if (confirmAction.status === 'Cancel' && tx.txStatus === 'Pending') {
          // v4.1 TO DO 1.7: Void pesanan gantung → kembalikan stok reserve (dipotong saat pending dibuat).
          // Guard hasSplitChildren: pending yang sudah displit dikelola sesi split — jangan revert.
          if (!hasSplitChildren(tx)) {
            const deductions = calculateDeductions(tx);
            revertStock(deductions, `Revert: Cancel pesanan gantung #${tx.queueNumber}`);
          }
        } else if (confirmAction.status === 'Demo' && tx.txStatus === 'Pending') {
          // v4.1 TO DO 1.7: Status Demo tidak tercatat sebagai penjualan → stok reserve dikembalikan agar tidak bocor.
          if (!hasSplitChildren(tx)) {
            const deductions = calculateDeductions(tx);
            revertStock(deductions, `Revert: Ubah pesanan gantung #${tx.queueNumber} menjadi Demo`);
          }
        } else if (confirmAction.status === 'Demo' && tx.txStatus === 'Selesai') {
          // v4.1 TO DO 1.7 (konsistensi): Selesai → Demo juga tidak tercatat sebagai penjualan → kembalikan stok & kunjungan.
          if (!hasSplitChildren(tx)) {
            const deductions = calculateDeductions(tx);
            revertStock(deductions, `Revert: Ubah transaksi #${tx.queueNumber} menjadi Demo`);
            if (tx.customerId) {
              revertVisit(tx.customerId, tx.totalAmount);
            }
          }
        } else if (confirmAction.status === 'Selesai' && tx.txStatus === 'Cancel') {
          if (!hasSplitChildren(tx)) {
            const deductions = calculateDeductions(tx);
            deductStock(deductions, `Deduct: Re-enable transaksi #${tx.queueNumber}`);
            if (tx.customerId) {
              recordVisit(tx.customerId, tx.totalAmount);
            }
          }
        }
      }
      updateTxStatus(confirmAction.id, confirmAction.status);
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'void_transaction', `Ubah status transaksi #${confirmAction.queueNumber || '?'} menjadi ${confirmAction.status}`, { transactionId: confirmAction.id, newStatus: confirmAction.status });
      }
    } else if (confirmAction.type === 'delete') {
      // ISSUE-1 fix: Revert stock & customer before deleting a completed transaction
      // v4.1 TO DO 1.6: Guard stok transaksi split (anak / induk beranak) — dikelola sesi split.
      const tx = transactions.find((t) => t.id === confirmAction.id);
      if (tx && tx.txStatus === 'Selesai' && !hasSplitChildren(tx)) {
        const deductions = calculateDeductions(tx);
        revertStock(deductions, `Revert: Hapus transaksi #${tx.queueNumber}`);
        if (tx.customerId) {
          revertVisit(tx.customerId, tx.totalAmount);
        }
      }
      deleteTransaction(confirmAction.id);
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'delete_transaction', `Hapus transaksi #${confirmAction.queueNumber || '?'}`, { transactionId: confirmAction.id });
      }
    }
    setConfirmAction(null);
  };

  const onPinSuccess = () => {
    if (!pinAction) return;
    if (pinAction.type === 'status' && pinAction.status) {
      const tx = transactions.find((t) => t.id === pinAction.id);
      if (tx) {
        if (pinAction.status === 'Cancel' && tx.txStatus === 'Selesai') {
          if (!hasSplitChildren(tx)) {
            const deductions = calculateDeductions(tx);
            revertStock(deductions, `Revert: Cancel transaksi #${tx.queueNumber}`);
            if (tx.customerId) {
              revertVisit(tx.customerId, tx.totalAmount);
            }
          }
        } else if (pinAction.status === 'Cancel' && tx.txStatus === 'Pending') {
          // v4.1 TO DO 1.7: Void pesanan gantung → kembalikan stok reserve (dipotong saat pending dibuat).
          // Guard hasSplitChildren: pending yang sudah displit dikelola sesi split — jangan revert.
          if (!hasSplitChildren(tx)) {
            const deductions = calculateDeductions(tx);
            revertStock(deductions, `Revert: Cancel pesanan gantung #${tx.queueNumber}`);
          }
        } else if (pinAction.status === 'Demo' && tx.txStatus === 'Pending') {
          // v4.1 TO DO 1.7: Status Demo tidak tercatat sebagai penjualan → stok reserve dikembalikan agar tidak bocor.
          if (!hasSplitChildren(tx)) {
            const deductions = calculateDeductions(tx);
            revertStock(deductions, `Revert: Ubah pesanan gantung #${tx.queueNumber} menjadi Demo`);
          }
        } else if (pinAction.status === 'Demo' && tx.txStatus === 'Selesai') {
          // v4.1 TO DO 1.7 (konsistensi): Selesai → Demo juga tidak tercatat sebagai penjualan → kembalikan stok & kunjungan.
          if (!hasSplitChildren(tx)) {
            const deductions = calculateDeductions(tx);
            revertStock(deductions, `Revert: Ubah transaksi #${tx.queueNumber} menjadi Demo`);
            if (tx.customerId) {
              revertVisit(tx.customerId, tx.totalAmount);
            }
          }
        } else if (pinAction.status === 'Selesai' && tx.txStatus === 'Cancel') {
          if (!hasSplitChildren(tx)) {
            const deductions = calculateDeductions(tx);
            deductStock(deductions, `Deduct: Re-enable transaksi #${tx.queueNumber}`);
            if (tx.customerId) {
              recordVisit(tx.customerId, tx.totalAmount);
            }
          }
        }
      }
      updateTxStatus(pinAction.id, pinAction.status);
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'void_transaction', `Ubah status transaksi ${pinAction.id} menjadi ${pinAction.status}`, { transactionId: pinAction.id, newStatus: pinAction.status });
      }
    } else if (pinAction.type === 'delete') {
      // ISSUE-1 fix: Revert stock & customer before deleting a completed transaction
      // v4.1 TO DO 1.6: Guard stok transaksi split (anak / induk beranak) — dikelola sesi split.
      const tx = transactions.find((t) => t.id === pinAction.id);
      if (tx && tx.txStatus === 'Selesai' && !hasSplitChildren(tx)) {
        const deductions = calculateDeductions(tx);
        revertStock(deductions, `Revert: Hapus transaksi #${tx.queueNumber}`);
        if (tx.customerId) {
          revertVisit(tx.customerId, tx.totalAmount);
        }
      }
      deleteTransaction(pinAction.id);
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'delete_transaction', `Hapus transaksi ${pinAction.id}`, { transactionId: pinAction.id });
      }
    }
    setPinAction(null);
  };

  const handleReprintConfirm = async (target: 'cashier' | 'all') => {
    if (!reprintTx) return;
    const receiptData = buildReceiptFromTransaction(reprintTx, settings, true);
    await printReceipt(receiptData, settings, target);
    addToast(`Struk #${reprintTx.queueNumber} dikirim ke printer (${target === 'all' ? 'Kasir + Dapur' : 'Kasir Saja'})`, 'success');
    setReprintTx(null);
  };

  const statusBadge = (status: TxStatus) => {
    switch (status) {
      case 'Selesai':
        return <span className="badge bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300"><CheckCircle2 size={12} /> Selesai</span>;
      case 'Cancel':
        return <span className="badge bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300"><Ban size={12} /> Cancel</span>;
      case 'Demo':
        return <span className="badge bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300"><FlaskConical size={12} /> Demo</span>;
      case 'Pending':
        return <span className="badge bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300"><Clock size={12} /> Pending</span>;
    }
  };

  const getConfirmMessage = () => {
    if (!confirmAction) return '';
    if (confirmAction.type === 'delete') {
      return `Hapus transaksi #${confirmAction.queueNumber || '?'} secara permanen? Data tidak bisa dikembalikan.`;
    }
    const statusLabel = confirmAction.status === 'Cancel' ? 'CANCEL (void)' : confirmAction.status;
    const base = `Ubah status transaksi #${confirmAction.queueNumber || '?'} menjadi "${statusLabel}"?`;
    // v4.1 TO DO 1.7: informasikan konsekuensi stok pada void pesanan gantung
    if (confirmAction.status === 'Cancel') {
      const tx = transactions.find((t) => t.id === confirmAction.id);
      if (tx?.txStatus === 'Pending') {
        return `${base} Stok bahan baku yang di-reserve akan dikembalikan.`;
      }
    }
    return base;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-center sm:text-left w-full sm:w-auto">📋 Riwayat Transaksi</h1>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              <FileText size={20} />
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Total Transaksi</p>
              <p className="text-lg font-bold">{stats.totalCount} <span className="text-xs font-normal text-slate-400">({stats.completedCount} selesai{stats.pendingCount > 0 ? `, ${stats.pendingCount} gantung` : ''})</span></p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-950/50 text-green-600 dark:text-green-400 flex items-center justify-center font-bold">
              <DollarSign size={20} />
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Total Omset Terfilter</p>
              <p className="text-lg font-bold text-green-700 dark:text-green-400">{formatRupiah(stats.totalOmset)}</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 flex items-center justify-center font-bold">
              <Ban size={20} />
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Transaksi Cancel (Void)</p>
              <p className="text-lg font-bold text-red-600 dark:text-red-400">{stats.cancelCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters & Controls */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Cari #Antrean, Nama Kasir/Pelanggan, Meja..."
              className="input pl-9 pr-8 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Date Filter Buttons / Select */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-slate-100 dark:bg-slate-700/50 p-1 rounded-xl text-xs font-medium">
              {(['today', 'week', 'month', 'all', 'custom'] as DateFilterType[]).map((f) => (
                <button
                  key={f}
                  onClick={() => { setDateFilter(f); setPage(1); }}
                  className={`px-3 py-1.5 rounded-lg transition capitalize ${
                    dateFilter === f
                      ? 'bg-white dark:bg-slate-800 shadow-sm text-brand-700 dark:text-brand-300 font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {f === 'today' ? 'Hari Ini' : f === 'week' ? '7 Hari' : f === 'month' ? 'Bulan Ini' : f === 'all' ? 'Semua' : 'Kustom'}
                </button>
              ))}
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }}
              className="input text-xs w-auto py-1.5"
            >
              <option value="all">Semua Status</option>
              <option value="Selesai">Selesai</option>
              <option value="Pending">Pending (Gantung)</option>
              <option value="Cancel">Cancel (Void)</option>
              <option value="Demo">Demo</option>
            </select>

            {/* Per Page */}
            <select
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
              className="input text-xs w-auto py-1.5"
            >
              <option value={10}>10 / hal</option>
              <option value={25}>25 / hal</option>
              <option value={50}>50 / hal</option>
            </select>
          </div>
        </div>

        {/* Custom date range inputs */}
        {dateFilter === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-700/50 text-xs">
            <span className="font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1">
              <Calendar size={14} /> Rentang Tanggal:
            </span>
            <input
              type="date"
              value={customDateFrom}
              onChange={(e) => { setCustomDateFrom(e.target.value); setPage(1); }}
              className="input text-xs w-auto py-1 px-2"
            />
            <span>s/d</span>
            <input
              type="date"
              value={customDateTo}
              onChange={(e) => { setCustomDateTo(e.target.value); setPage(1); }}
              className="input text-xs w-auto py-1 px-2"
            />
          </div>
        )}
      </div>

      {/* Transaction List */}
      {filteredTx.length === 0 ? (
        <div className="card p-12 text-center text-slate-400 dark:text-slate-500">
          <p className="text-base font-medium">Tidak ada transaksi ditemukan</p>
          <p className="text-xs text-slate-400 mt-1">Coba ubah filter tanggal atau kata kunci pencarian Anda.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedTx.map((tx) => (
            <div key={tx.id} className="card overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === tx.id ? null : tx.id)}
                className="w-full p-4 flex items-center gap-4 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 transition"
              >
                <div className="w-10 h-10 rounded-xl bg-brand-100 dark:bg-brand-900/50 flex items-center justify-center font-bold text-brand-700 dark:text-brand-300">
                  #{tx.queueNumber}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm dark:text-slate-200">{formatDate(tx.date)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {tx.paymentMethod} • {tx.items.length} item • {tx.cashierName}
                    {tx.customerName && <span className="ml-1 text-brand-600 font-semibold">• CRM: {tx.customerName}</span>}
                    {tx.orderType && (
                      <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        tx.orderType === 'Take Away'
                          ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                          : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      }`}>
                        {tx.orderType}{tx.tableNumber ? ` (${tx.tableNumber})` : ''}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-brand-700 dark:text-brand-300">{formatRupiah(tx.totalAmount)}</p>
                  {statusBadge(tx.txStatus)}
                </div>
                {expanded === tx.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {expanded === tx.id && (
                <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-700/50 pt-3 space-y-3">
                  {/* Items */}
                  <div className="space-y-2.5">
                    {tx.items.map((item) => (
                      <div key={item.lineId} className="border-b border-slate-100 dark:border-slate-800 pb-2.5 last:border-0">
                        <div className="flex justify-between text-sm">
                          <div>
                            <span className="font-medium dark:text-slate-200">{item.name}</span>
                            <span className="text-slate-500 dark:text-slate-400 ml-2">
                              x{item.quantity}{item.showTemperature !== false ? ` • ${item.temperature}` : ''}{item.showSugarLevel !== false ? ` • ${item.sugar}` : ''}
                            </span>
                            {item.addons.length > 0 && (
                              <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">
                                (+{item.addons.map((a) => a.name).join(', ')})
                              </span>
                            )}
                          </div>
                          <span className="font-medium dark:text-slate-200">{formatRupiah(item.subtotal)}</span>
                        </div>

                        {/* Snapshot Recipe (BOM) Breakdown - Manager Only */}
                        {currentUser?.role === 'Manager' && item.recipeSnapshot && item.recipeSnapshot.length > 0 && (
                          <div className="mt-1.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50 text-xs">
                            <div className="flex items-center justify-between font-semibold text-slate-600 dark:text-slate-300 mb-1">
                              <span>📦 Snapshot Recipe (BOM):</span>
                              <span className="text-brand-600 dark:text-brand-400">Modal HPP: {formatRupiah(item.hpp || item.cogs || 0)}</span>
                            </div>
                            <div className="space-y-0.5 text-slate-500 dark:text-slate-400">
                              {item.recipeSnapshot.map((ing, idx) => (
                                <div key={idx} className="flex justify-between items-center text-[11px]">
                                  <span>• {ing.inventoryName} ({ing.totalQty} {ing.unit})</span>
                                  <span>{formatRupiah(ing.unitCost)}/{ing.unit} = <strong className="text-slate-700 dark:text-slate-300">{formatRupiah(ing.subtotalCost)}</strong></span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Summary & Snapshot HPP */}
                  <div className="space-y-1 pt-1 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-700/50">
                    {tx.discount > 0 && (
                      <div className="flex justify-between text-sm text-red-500 dark:text-red-400">
                        <span>Diskon</span>
                        <span>-{formatRupiah(tx.discount)}</span>
                      </div>
                    )}

                    {tx.tax !== undefined && tx.tax > 0 && (
                      <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
                        <span>Pajak</span>
                        <span>{formatRupiah(tx.tax)}</span>
                      </div>
                    )}

                    {/* HPP & Gross Profit - Manager Only */}
                    {currentUser?.role === 'Manager' && (
                      <>
                        <div className="flex justify-between items-center pt-1">
                          <span>Total HPP Snapshot (COGS):</span>
                          <span className="font-bold text-slate-700 dark:text-slate-300">{formatRupiah(tx.cogs ?? tx.hpp)}</span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span>Estimasi Laba Kotor (Gross Profit):</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            {formatRupiah(tx.grossProfit ?? ((tx.subtotal - tx.discount) - tx.hpp))}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/50">
                    <button
                      onClick={() => setReprintTx(tx)}
                      className="btn-secondary text-xs text-blue-600 dark:text-blue-400 flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto"
                      title="Cetak Ulang Struk"
                    >
                      <Printer size={14} /> Cetak Ulang
                    </button>
                    {tx.txStatus !== 'Selesai' && (
                      <button
                        onClick={() => handleStatusChange(tx.id, 'Selesai', tx.queueNumber)}
                        className="btn-secondary text-xs flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto"
                      >
                        <CheckCircle2 size={14} /> Selesai
                      </button>
                    )}
                    {tx.txStatus !== 'Cancel' && (
                      <button
                        onClick={() => handleStatusChange(tx.id, 'Cancel', tx.queueNumber)}
                        className="btn-secondary text-xs text-red-600 dark:text-red-400 flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto"
                      >
                        <Ban size={14} /> Cancel (Void)
                      </button>
                    )}
                    {tx.txStatus !== 'Demo' && (
                      <button
                        onClick={() => handleStatusChange(tx.id, 'Demo', tx.queueNumber)}
                        className="btn-secondary text-xs text-purple-600 dark:text-purple-400 flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto"
                      >
                        <FlaskConical size={14} /> Demo
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(tx.id, tx.queueNumber)}
                      className="btn-secondary text-xs text-red-600 dark:text-red-400 flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto sm:ml-auto"
                    >
                      <Trash2 size={14} /> Hapus
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between card p-3 text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            Halaman {page} dari {totalPages} ({filteredTx.length} item)
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary p-1.5 disabled:opacity-40"
              title="Halaman sebelumnya"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-secondary p-1.5 disabled:opacity-40"
              title="Halaman berikutnya"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* PIN Modal for Kasir */}
      <PinModal
        open={!!pinAction}
        onClose={() => setPinAction(null)}
        onSuccess={onPinSuccess}
      />

      {/* Confirm Dialog for Manager */}
      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={confirmAction?.type === 'delete' ? 'Hapus Transaksi' : 'Ubah Status Transaksi'}
        message={getConfirmMessage()}
        confirmText={confirmAction?.type === 'delete' ? 'Hapus' : 'Ya, Ubah'}
        variant={confirmAction?.type === 'delete' || confirmAction?.status === 'Cancel' ? 'danger' : 'warning'}
        onConfirm={onConfirmAction}
      />

      {/* Modal Dialog Cetak Ulang Struk (Item 5) */}
      {reprintTx && (
        <Modal open={!!reprintTx} onClose={() => setReprintTx(null)} title={`🖨️ Cetak Ulang Struk #${reprintTx.queueNumber}`}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Pilih target printer untuk mencetak ulang transaksi <strong>#{reprintTx.queueNumber}</strong> ({formatRupiah(reprintTx.totalAmount)}):
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => handleReprintConfirm('cashier')}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-brand-500 hover:bg-brand-50/50 dark:hover:bg-brand-950/20 text-left transition space-y-1"
              >
                <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 text-sm">
                  <Printer size={18} className="text-brand-600" />
                  <span>Printer Kasir Saja</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Hanya mencetak Struk Konsumen di printer utama kasir.
                </p>
              </button>

              <button
                onClick={() => handleReprintConfirm('all')}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-brand-500 hover:bg-brand-50/50 dark:hover:bg-brand-950/20 text-left transition space-y-1"
              >
                <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 text-sm">
                  <Printer size={18} className="text-purple-600" />
                  <span>Semua Printer</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Cetak Struk Kasir + Tiket Dapur / Bar ke seluruh printer.
                </p>
              </button>
            </div>

            <div className="flex justify-end pt-3">
              <button onClick={() => setReprintTx(null)} className="btn-secondary text-sm">
                Batal
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
