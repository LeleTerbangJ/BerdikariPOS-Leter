import { useState, useEffect, useMemo, useRef } from 'react';
import { useTransactionStore, isPendingTransaction } from '../store/transactionStore';
import { useAuthStore } from '../store/authStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { useMenuStore } from '../store/menuStore';
import { useInventoryStore } from '../store/inventoryStore';
import { useCustomerStore } from '../store/customerStore';
import { useSettingsStore } from '../store/settingsStore';
import { useToastStore } from '../store/toastStore';
import { useCashMovementStore } from '../store/cashMovementStore';
import { subscribeToTransactions, unsubscribeChannel, fetchTransactionsFromCloud } from '../lib/cloudSync';
import { isSupabaseConfigured } from '../lib/supabase';
import { formatRupiah, formatDate, buildCustomDateRange } from '../utils/format';
import { calculateItemDeductions } from '../utils/hpp';
import { applyStatusStockEffects, type StockEffectStatus } from '../utils/transactionStockActions';
import { printReceipt, buildReceiptFromTransaction } from '../utils/printer';
// v4.7 TO DO 11.2 (P0.2): refund/retur penuh
import { isRefundableTransaction, canExecuteRefund, refundAmount, refundMovementNotes, REFUND_CASH_CATEGORY } from '../utils/refund';
// v4.7 TO DO 11.2 (P0.4): struk digital (WA/email)
import { buildReceiptText, buildWhatsAppUrl, buildMailtoUrl, findCustomerContact } from '../utils/digitalReceipt';
// v4.7 TO DO 18.2 (Prioritas 18): badge "#N duplikat" — deteksi nomor antrean kembar lintas device
import { findDuplicateQueueNumbers } from '../utils/queueNumber';
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
  RotateCcw,
  MessageCircle,
  Mail,
} from 'lucide-react';

type DateFilterType = 'today' | 'week' | 'month' | 'all' | 'custom';

export default function Transactions() {
  // v4.7 TO DO 13.7 (O-5): confirmedSyncIds — badge "Belum Sync" per transaksi
  const { transactions, updateTxStatus, deleteTransaction, loadFromCloud, updateTxMeta, confirmedSyncIds } = useTransactionStore();
  // v4.7 TO DO 18.2 (Prioritas 18): nomor antrean yang muncul > 1× di hari yang sama (2 kasir offline)
  const dupQueueNumbers = useMemo(() => findDuplicateQueueNumbers(transactions), [transactions]);
  const { currentUser } = useAuthStore();
  const { addLog } = useAuditLogStore();
  const { menus } = useMenuStore();
  const { revertStock, deductStock } = useInventoryStore();
  const { recordVisit, revertVisit } = useCustomerStore();
  const { settings } = useSettingsStore();
  const { addToast } = useToastStore();
  const { addMovement } = useCashMovementStore();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [pinAction, setPinAction] = useState<{ type: 'status' | 'delete'; id: string; status?: TxStatus } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'status' | 'delete'; id: string; status?: TxStatus; queueNumber?: number } | null>(null);
  const [reprintTx, setReprintTx] = useState<Transaction | null>(null);
  // v4.7 TO DO 11.2 (P0.2): refund penuh — modal alasan + otorisasi (Manager langsung, selain itu PIN)
  const [refundTx, setRefundTx] = useState<Transaction | null>(null);
  const [refundNote, setRefundNote] = useState('');
  const [showRefundPin, setShowRefundPin] = useState(false);
  const [refundPending, setRefundPending] = useState<{ tx: Transaction; note: string } | null>(null);
  // v4.7 TO DO 18.8 (A4): guard anti double-refund — cek ulang dari STORE (salinan render
  // bisa basi: refunded belum ter-update) + ref in-flight + state processing tombol.
  const refundingRef = useRef(false);
  const [refundProcessing, setRefundProcessing] = useState(false);

  // v4.7 TO DO 11.2 (P0.4): struk digital — kirim ke WA/email pelanggan
  const { customers } = useCustomerStore();
  const [digitalTx, setDigitalTx] = useState<Transaction | null>(null);
  const [digitalPhone, setDigitalPhone] = useState('');
  const [digitalEmail, setDigitalEmail] = useState('');

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

    const refreshFromCloud = (fullSync = false) => {
      fetchTransactionsFromCloud().then((cloudTx) => {
        if (cloudTx) loadFromCloud(cloudTx, fullSync);
      });
    };

    const channel = subscribeToTransactions(() => {
      refreshFromCloud(true); // fullSync: cloud is authoritative
    });

    // v4.7 TO DO 13.7 (O-5): saat koneksi pulih, tarik cloud → confirmedSyncIds diperbarui
    // (badge "Belum Sync" hilang untuk transaksi yang baru saja ter-flush dari offline queue)
    const handleOnline = () => refreshFromCloud(true);
    window.addEventListener('online', handleOnline);

    return () => {
      if (channel) unsubscribeChannel(channel);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  // BUG-03 fix: Filter transactions dynamically based on Date Filter, Status Filter & Search Query
  const filteredTx = useMemo(() => {
    const now = new Date();

    return transactions.filter((t) => {
      // v4.5 Perbaikan 4.3: Sembunyikan sub-bill (anak split) dari daftar transaksi — cukup tampilkan induk saja
      if (t.splitParentId) return false;

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
          const { from, to } = buildCustomDateRange(customDateFrom, customDateTo);
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
        // v4.7 TO DO 18.8 (A13): demo fresh (queueNumber 0) bisa dicari sebagai "demo"
        const queueStr = t.txStatus === 'Demo' && !t.queueNumber ? 'demo' : `#${t.queueNumber}`;
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
    // v4.7 TO DO 11.2 (P0.2): transaksi yang sudah di-refund tidak lagi dihitung sebagai omset.
    const completed = filteredTx.filter((t) => t.txStatus === 'Selesai' && !t.splitParentId && !t.refunded);
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

  // v4.7 TO DO 8.1 & 8.2: Satu-satunya jalur efek stok/kunjungan untuk transisi status & delete
  // (sebelumnya dua rantai if-else identik di onConfirmAction & onPinSuccess — Demo→Selesai
  // dan hapus Pending tidak pernah deduct/revert → stok bocor).
  const applyStockEffects = (tx: Transaction, toStatus: StockEffectStatus) => {
    const isSplit = hasSplitChildren(tx);
    // v4.7 TO DO 18.8 (A9): SOP void split — cancel parent pending beranak split (atau sub-bill
    // itu sendiri) TIDAK otomatis mengembalikan stok bagian yang belum lunas (guard stok split);
    // stok hanya kembali bila setiap sub-bill Selesai di-void satu per satu. Kasir diingatkan.
    if (toStatus === 'Cancel' && isSplit) {
      addToast(
        'Transaksi ini bagian dari split bill — stok bagian belum lunas hanya kembali bila setiap sub-bill Selesai di-void satu per satu.',
        'warning',
        7000
      );
    }
    applyStatusStockEffects(
      tx,
      toStatus,
      isSplit,
      () => calculateDeductions(tx),
      { revertStock, deductStock, revertVisit, recordVisit }
    );
  };

  // Execute after Manager confirms
  const onConfirmAction = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'status' && confirmAction.status) {
      const tx = transactions.find((t) => t.id === confirmAction.id);
      if (tx) {
        // TO DO 8.1: termasuk Demo → Selesai (sebelumnya hanya Cancel → Selesai yang deduct)
        applyStockEffects(tx, confirmAction.status);
      }
      updateTxStatus(confirmAction.id, confirmAction.status);
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'void_transaction', `Ubah status transaksi #${confirmAction.queueNumber || '?'} menjadi ${confirmAction.status}`, { transactionId: confirmAction.id, newStatus: confirmAction.status });
      }
    } else if (confirmAction.type === 'delete') {
      // ISSUE-1 fix: Revert stock & customer before deleting a completed transaction
      // v4.1 TO DO 1.6: Guard stok transaksi split (anak / induk beranak) — dikelola sesi split.
      // v4.7 TO DO 8.2: hapus Pending juga me-revert stok reserve (sebelumnya hanya Selesai).
      const tx = transactions.find((t) => t.id === confirmAction.id);
      if (tx) {
        applyStockEffects(tx, 'DELETE');
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
        // TO DO 8.1: termasuk Demo → Selesai (sebelumnya hanya Cancel → Selesai yang deduct)
        applyStockEffects(tx, pinAction.status);
      }
      updateTxStatus(pinAction.id, pinAction.status);
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'void_transaction', `Ubah status transaksi ${pinAction.id} menjadi ${pinAction.status}`, { transactionId: pinAction.id, newStatus: pinAction.status });
      }
    } else if (pinAction.type === 'delete') {
      // ISSUE-1 fix: Revert stock & customer before deleting a completed transaction
      // v4.1 TO DO 1.6: Guard stok transaksi split (anak / induk beranak) — dikelola sesi split.
      // v4.7 TO DO 8.2: hapus Pending juga me-revert stok reserve (sebelumnya hanya Selesai).
      const tx = transactions.find((t) => t.id === pinAction.id);
      if (tx) {
        applyStockEffects(tx, 'DELETE');
      }
      deleteTransaction(pinAction.id);
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'delete_transaction', `Hapus transaksi ${pinAction.id}`, { transactionId: pinAction.id });
      }
    }
    setPinAction(null);
  };

  // ============================================================
  // v4.7 TO DO 11.2 (P0.2) — Refund / Retur Penuh
  // ============================================================
  const handleRefund = (tx: Transaction) => {
    setRefundTx(tx);
    setRefundNote('');
  };

  // Otorisasi: Manager langsung eksekusi; role lain lewat PIN (seperti void/delete).
  // v4.7 TO DO 18.8 (A4): tombol Konfirmasi ber-state processing — mencegah klik ganda.
  const confirmRefund = () => {
    if (!refundTx) return;
    const note = refundNote.trim();
    if (currentUser?.role === 'Manager') {
      setRefundProcessing(true);
      try {
        executeRefund(refundTx, note);
      } finally {
        setRefundProcessing(false);
        setRefundTx(null);
      }
    } else {
      setRefundPending({ tx: refundTx, note });
      setRefundTx(null);
      setShowRefundPin(true);
    }
  };

  // Eksekusi refund penuh: revert stok + kunjungan, Kas Keluar 'Refund' di Rekap Kas,
  // tandai refunded (sync cloud lintas device), audit log.
  // v4.7 TO DO 18.8 (A4): anti double-refund — guard isRefundableTransaction memakai salinan
  // RENDER (refunded belum ter-update) sehingga dua klik cepat bisa lolos keduanya → revert
  // stok ganda + 2× Kas Keluar Refund. Solusi: (1) cek ulang `refunded` dari STORE di awal,
  // (2) ref in-flight (proteksi reentrancy masa depan bila fungsi jadi async), (3) tombol
  // Konfirmasi ber-state processing + disable tombol Refund saat PIN pending.
  const executeRefund = (tx: Transaction, note: string) => {
    if (!currentUser) return;
    // v4.7 TO DO 18.8 (A4): guard anti double-refund — cek ulang `refunded` dari STORE
    // (salinan render bisa basi) + in-flight guard + split guard; pakai TARGET terbaru.
    const target = canExecuteRefund(
      tx,
      useTransactionStore.getState().transactions,
      hasSplitChildren,
      refundingRef.current
    );
    if (!target) return;
    refundingRef.current = true;
    try {
      const amount = refundAmount(target);

      // 1) Stok dikembalikan (full) — pakai recipeSnapshot tersimpan via calculateItemDeductions
      const deductions = calculateDeductions(target);
      if (Object.keys(deductions).length > 0) {
        revertStock(deductions, `Refund transaksi #${target.queueNumber}`);
      }

      // 2) Kunjungan pelanggan dikembalikan
      if (target.customerId) revertVisit(target.customerId, target.totalAmount);

      // 3) Kas Keluar 'Refund' — akuntabel di Rekap Kas (online langsung / offline antre + retry)
      addMovement('out', amount, REFUND_CASH_CATEGORY, refundMovementNotes(target, note), currentUser.id, currentUser.name);

      // 4) Tandai refunded + sync ke cloud (device lain melihat status refund & eksklusi omset)
      updateTxMeta(target.id, {
        refunded: true,
        refundedAt: new Date().toISOString(),
        refundedAmount: amount,
        refundNote: note || undefined,
        refundedById: currentUser.id,
        refundedByName: currentUser.name,
      });

      // 5) Audit log
      addLog(currentUser.id, currentUser.name, currentUser.role, 'refund_transaction',
        `Refund transaksi #${target.queueNumber} sebesar ${formatRupiah(amount)}${note ? ` — ${note}` : ''}`,
        { transactionId: target.id, refundedAmount: amount, note: note || undefined });

      addToast(`Refund transaksi #${target.queueNumber} berhasil (${formatRupiah(amount)})`, 'success');
    } finally {
      refundingRef.current = false;
    }
  };

  const handleReprintConfirm = async (target: 'cashier' | 'all') => {
    if (!reprintTx) return;
    const receiptData = buildReceiptFromTransaction(reprintTx, settings, true);
    await printReceipt(receiptData, settings, target);
    addToast(`Struk #${reprintTx.queueNumber} dikirim ke printer (${target === 'all' ? 'Kasir + Dapur' : 'Kasir Saja'})`, 'success');
    setReprintTx(null);
  };

  // ============================================================
  // v4.7 TO DO 11.2 (P0.4) — Struk Digital (WhatsApp / Email)
  // ============================================================

  // Buka modal dengan kontak pelanggan terisi otomatis dari CRM (bisa di-override manual)
  const openDigitalReceipt = (tx: Transaction) => {
    const contact = findCustomerContact(tx, customers);
    setDigitalTx(tx);
    setDigitalPhone(contact.phone || '');
    setDigitalEmail(contact.email || '');
  };

  // Isi struk teks polos (sama untuk WA & email)
  const digitalReceiptText = (tx: Transaction): string => {
    const receiptData = buildReceiptFromTransaction(tx, settings);
    return buildReceiptText(receiptData);
  };

  // Kirim via WhatsApp: deep-link wa.me dengan struk lengkap sebagai isi pesan
  const sendDigitalWhatsApp = () => {
    if (!digitalTx || !currentUser) return;
    const url = buildWhatsAppUrl(digitalPhone, digitalReceiptText(digitalTx));
    if (!url) {
      addToast('Nomor WhatsApp tidak valid. Isi minimal 9 digit.', 'error');
      return;
    }
    window.open(url, '_blank');
    addLog(currentUser.id, currentUser.name, currentUser.role, 'send_digital_receipt',
      `Kirim struk digital #${digitalTx.queueNumber} via WhatsApp ke ${normalizeDisplay(digitalPhone)}`,
      { transactionId: digitalTx.id, channel: 'whatsapp', phone: digitalPhone });
    addToast(`Struk #${digitalTx.queueNumber} dibuka di WhatsApp`, 'success');
    setDigitalTx(null);
  };

  // Kirim via Email: mailto dengan struk sebagai body
  const sendDigitalEmail = () => {
    if (!digitalTx || !currentUser) return;
    const url = buildMailtoUrl(digitalEmail, `Struk #${digitalTx.queueNumber} - ${settings.storeName}`, digitalReceiptText(digitalTx));
    if (!url) {
      addToast('Alamat email tidak valid.', 'error');
      return;
    }
    window.open(url, '_blank');
    addLog(currentUser.id, currentUser.name, currentUser.role, 'send_digital_receipt',
      `Kirim struk digital #${digitalTx.queueNumber} via email ke ${digitalEmail}`,
      { transactionId: digitalTx.id, channel: 'email', email: digitalEmail });
    addToast(`Struk #${digitalTx.queueNumber} dibuka di email client`, 'success');
    setDigitalTx(null);
  };

  // Tampilkan nomor seperti aslinya di audit log (bukan hasil normalisasi)
  function normalizeDisplay(phone: string): string {
    return phone.trim() || '(tanpa nomor)';
  }

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
        {/* v4.7 TO DO 13.7 (O-5): hitung transaksi yang belum terkonfirmasi sync */}
        {(() => {
          const unsynced = filteredTx.filter((t) => !confirmedSyncIds.includes(t.id)).length;
          return unsynced > 0 ? (
            <span className="badge bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 whitespace-nowrap">
              <Clock size={12} /> ⚠️ {unsynced} belum sync
            </span>
          ) : null;
        })()}
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
                <div className="w-10 h-10 rounded-xl bg-brand-100 dark:bg-brand-900/50 flex items-center justify-center font-bold text-brand-700 dark:text-brand-300 text-[10px]">
                  {/* v4.7 TO DO 18.8 (A13): transaksi demo FRESH tidak memakai nomor antrean
                      (queueNumber 0) — tampilkan label DEMO. Demo hasil konversi dari Selesai
                      tetap memakai nomor aslinya. */}
                  {tx.txStatus === 'Demo' && !tx.queueNumber ? 'DEMO' : `#${tx.queueNumber}`}
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
                  <div className="flex items-center justify-end gap-1 flex-wrap">
                    {statusBadge(tx.txStatus)}
                    {/* v4.7 TO DO 11.2 (P0.2): badge transaksi yang sudah di-refund */}
                    {tx.refunded && (
                      <span className="badge bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300"><RotateCcw size={12} /> Refund</span>
                    )}
                    {/* v4.7 TO DO 13.7 (O-5): badge "Belum Sync" per transaksi */}
                    {!confirmedSyncIds.includes(tx.id) && (
                      <span
                        className="badge bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300"
                        title="Transaksi ini belum tersinkron ke cloud — akan dikirim otomatis saat online"
                      >
                        <Clock size={12} /> Belum Sync
                      </span>
                    )}
                    {/* v4.7 TO DO 18.2 (Prioritas 18): badge nomor antrean duplikat (2 kasir) */}
                    {dupQueueNumbers.has(tx.queueNumber) && (
                      <span
                        className="badge bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300"
                        title="Nomor antrean ini muncul lebih dari satu kali hari ini (kemungkinan dua kasir memproses bersamaan saat offline). Periksa & void salah satu bila perlu."
                      >
                        <Ban size={12} /> #{tx.queueNumber} duplikat
                      </span>
                    )}
                  </div>
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

                  {/* v4.7 TO DO 11.2 (P0.2): info refund di detail */}
                  {tx.refunded && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl text-xs text-amber-800 dark:text-amber-300 space-y-1">
                      <p>
                        <strong>Transaksi ini telah di-refund</strong> — {formatRupiah(tx.refundedAmount ?? tx.totalAmount)}{' '}
                        {tx.refundedAt ? `pada ${formatDate(tx.refundedAt)}` : ''}
                        {tx.refundedByName ? ` oleh ${tx.refundedByName}` : ''}. Stok sudah dikembalikan & Kas Keluar 'Refund' tercatat di Rekap Kas.
                      </p>
                      {tx.refundNote && <p>Alasan: {tx.refundNote}</p>}
                    </div>
                  )}

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
                    {/* v4.7 TO DO 11.2 (P0.4): struk digital — kirim ke WhatsApp/email pelanggan */}
                    <button
                      onClick={() => openDigitalReceipt(tx)}
                      className="btn-secondary text-xs text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto"
                      title="Kirim struk digital via WhatsApp / Email"
                    >
                      <MessageCircle size={14} /> Struk Digital
                    </button>
                    {/* v4.7 TO DO 11.2 (P0.2): transaksi refunded tidak boleh diubah statusnya
                        lagi (stok & kunjungan sudah di-revert) — hanya cetak/hapus. */}
                    {tx.txStatus !== 'Selesai' && !tx.refunded && (
                      <button
                        onClick={() => handleStatusChange(tx.id, 'Selesai', tx.queueNumber)}
                        className="btn-secondary text-xs flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto"
                      >
                        <CheckCircle2 size={14} /> Selesai
                      </button>
                    )}
                    {tx.txStatus === 'Selesai' && isRefundableTransaction(tx, hasSplitChildren(tx)) && (
                      <button
                        onClick={() => handleRefund(tx)}
                        // v4.7 TO DO 18.8 (A4): disable saat otorisasi PIN pending / sedang processing
                        disabled={!!refundPending || refundProcessing}
                        className="btn-secondary text-xs text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto disabled:opacity-40"
                        title="Refund / Retur penuh — stok dikembalikan & Kas Keluar 'Refund' dicatat"
                      >
                        <RotateCcw size={14} /> Refund
                      </button>
                    )}
                    {tx.txStatus !== 'Cancel' && !tx.refunded && (
                      <button
                        onClick={() => handleStatusChange(tx.id, 'Cancel', tx.queueNumber)}
                        className="btn-secondary text-xs text-red-600 dark:text-red-400 flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto"
                      >
                        <Ban size={14} /> Cancel (Void)
                      </button>
                    )}
                    {tx.txStatus !== 'Demo' && !tx.refunded && (
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

      {/* v4.7 TO DO 11.2 (P0.2): PIN otorisasi refund (role non-Manager) */}
      <PinModal
        open={showRefundPin}
        onClose={() => { setShowRefundPin(false); setRefundPending(null); }}
        onSuccess={() => {
          if (refundPending) {
            executeRefund(refundPending.tx, refundPending.note);
            setRefundPending(null);
          }
          setShowRefundPin(false);
        }}
        title="Otorisasi Refund — PIN Manager"
      />

      {/* v4.7 TO DO 11.2 (P0.2): modal konfirmasi refund */}
      {refundTx && (
        <Modal open={!!refundTx} onClose={() => setRefundTx(null)} title={`Refund Transaksi #${refundTx.queueNumber}`} maxWidth="max-w-md">
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl text-xs text-amber-800 dark:text-amber-300 space-y-1">
              <p>
                <strong>Refund penuh {formatRupiah(refundAmount(refundTx))}</strong> untuk transaksi #{refundTx.queueNumber} ({formatDate(refundTx.date)}).
              </p>
              <p>Stok bahan baku dikembalikan ke inventory, dan <strong>Kas Keluar 'Refund'</strong> dicatat di Rekap Kas.</p>
              <p>Transaksi ini tidak lagi dihitung sebagai penjualan di laporan.</p>
            </div>
            <div>
              <label className="label">Alasan Refund (Opsional)</label>
              <textarea value={refundNote} onChange={(e) => setRefundNote(e.target.value)} className="input" rows={2} placeholder="Mis. pelanggan mengembalikan pesanan..." />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setRefundTx(null)} disabled={refundProcessing} className="btn-secondary flex-1 disabled:opacity-40">Batal</button>
              {/* v4.7 TO DO 18.8 (A4): state processing anti klik ganda */}
              <button onClick={confirmRefund} disabled={refundProcessing} className="btn-primary flex-1 disabled:opacity-60">
                {refundProcessing ? 'Memproses…' : 'Konfirmasi Refund'}
              </button>
            </div>
          </div>
        </Modal>
      )}

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

      {/* v4.7 TO DO 11.2 (P0.4): modal kirim struk digital (WA/email) */}
      {digitalTx && (
        <Modal open={!!digitalTx} onClose={() => setDigitalTx(null)} title={`📱 Kirim Struk Digital #${digitalTx.queueNumber}`} maxWidth="max-w-md">
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Struk <strong>#{digitalTx.queueNumber}</strong> ({formatRupiah(digitalTx.totalAmount)}) akan dikirim ke pelanggan{' '}
              {digitalTx.customerName ? <strong>{digitalTx.customerName}</strong> : '(tanpa nama CRM)'}.
            </p>

            <div className="space-y-3">
              <div>
                <label className="label">Nomor WhatsApp</label>
                <input
                  type="tel"
                  value={digitalPhone}
                  onChange={(e) => setDigitalPhone(e.target.value)}
                  placeholder="08xx xxxx xxxx"
                  className="input text-sm"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Terisi otomatis dari data pelanggan (CRM) — bisa diubah manual. Format Indonesia (0xx / +62) otomatis disesuaikan.
                </p>
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  value={digitalEmail}
                  onChange={(e) => setDigitalEmail(e.target.value)}
                  placeholder="pelanggan@email.com"
                  className="input text-sm"
                />
              </div>
            </div>

            {/* Pratinjau struk */}
            <div>
              <p className="label">Pratinjau Struk</p>
              <pre className="max-h-48 overflow-auto rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 p-3 text-[10px] leading-relaxed font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                {digitalReceiptText(digitalTx)}
              </pre>
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setDigitalTx(null)} className="btn-secondary flex-1">Batal</button>
              <button
                onClick={sendDigitalWhatsApp}
                className="btn-primary flex-1 bg-green-600 hover:bg-green-700"
              >
                <MessageCircle size={16} /> Kirim WhatsApp
              </button>
              <button
                onClick={sendDigitalEmail}
                className="btn-primary flex-1"
              >
                <Mail size={16} /> Kirim Email
              </button>
            </div>
            <p className="text-[11px] text-slate-400 text-center">
              Membuka aplikasi WhatsApp / email client dengan struk sudah terisi — tinggal kirim.
            </p>
          </div>
        </Modal>
      )}

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
