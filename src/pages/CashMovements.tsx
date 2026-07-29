import { useState, useMemo, useEffect } from 'react';
import { useCashMovementStore } from '../store/cashMovementStore';
import { useAuthStore } from '../store/authStore';
import { useShiftStore } from '../store/shiftStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { formatRupiah, formatDate } from '../utils/format';
import type { CashMovement, CashMovementType } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import PinModal from '../components/PinModal';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Plus,
  Minus,
  Search,
  Calendar,
  Trash2,
  Pencil,
  AlertCircle,
  FileText,
} from 'lucide-react';

const CATEGORIES_IN = [
  'Modal Tambahan',
  'Pemasukan Operasional',
  'Pengembalian Dana',
  'Lain-lain',
];

const CATEGORIES_OUT = [
  'Pembelian Bahan/Inventaris',
  'Biaya Operasional Toko',
  'Uang Makan / Transport',
  'Biaya Kebersihan & Listrik',
  'Setor Kas ke Manager',
  'Lain-lain',
];

type DateFilterType = 'today' | 'week' | 'month' | 'all';

export default function CashMovements() {
  const { movements, addMovement, updateMovement, deleteMovement, loadFromCloud } = useCashMovementStore();
  const { currentUser } = useAuthStore();
  const { activeShift } = useShiftStore();
  const { addLog } = useAuditLogStore();

  // Real-time sync for cash movements
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    loadFromCloud();
    const channelName = 'cm-page-rt-' + Math.random().toString(36).substring(2, 9);
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_movements' }, () => {
        loadFromCloud();
      })
      .subscribe();
    return () => { try { supabase.removeChannel(channel); } catch (e) {} };
  }, []);

  const [dateFilter, setDateFilter] = useState<DateFilterType>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Modal & FAB State
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<CashMovementType>('out');
  const [fabOpen, setFabOpen] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [categoryInput, setCategoryInput] = useState(CATEGORIES_OUT[0]);
  const [customCategory, setCustomCategory] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Pin Modal & Action State
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'edit' | 'delete'; movement: CashMovement } | null>(null);

  // Edit Modal State
  const [editingMovement, setEditingMovement] = useState<CashMovement | null>(null);
  const [editType, setEditType] = useState<CashMovementType>('out');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editCustomCategory, setEditCustomCategory] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const filteredMovements = useMemo(() => {
    const now = new Date();
    return movements.filter((m) => {
      // Date filter
      const d = new Date(m.date);
      let matchesDate = true;
      if (dateFilter === 'today') {
        matchesDate = d.toDateString() === now.toDateString();
      } else if (dateFilter === 'week') {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        matchesDate = d >= weekAgo;
      } else if (dateFilter === 'month') {
        matchesDate = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }

      // Search & category filter
      const matchesSearch =
        m.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.notes || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.cashierName.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCat = categoryFilter === 'all' || m.category === categoryFilter;

      return matchesDate && matchesSearch && matchesCat;
    });
  }, [movements, dateFilter, searchQuery, categoryFilter]);

  // Compute KPI totals
  const totals = useMemo(() => {
    const totalIn = filteredMovements
      .filter((m) => m.type === 'in')
      .reduce((a, m) => a + m.amount, 0);
    const totalOut = filteredMovements
      .filter((m) => m.type === 'out')
      .reduce((a, m) => a + m.amount, 0);
    return { totalIn, totalOut, net: totalIn - totalOut };
  }, [filteredMovements]);

  const handleOpenModal = (type: CashMovementType) => {
    setModalType(type);
    setAmountInput('');
    const defaultCategories = type === 'in' ? CATEGORIES_IN : CATEGORIES_OUT;
    setCategoryInput(defaultCategories[0]);
    setCustomCategory('');
    setNotesInput('');
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(amountInput) || 0;
    if (amount <= 0) {
      alert('Nominal harus lebih dari 0');
      return;
    }

    const finalCategory = categoryInput === 'Lain-lain' && customCategory ? customCategory : categoryInput;

    if (!currentUser) return;

    const created = addMovement(
      modalType,
      amount,
      finalCategory,
      notesInput,
      currentUser.id,
      currentUser.name,
      activeShift?.id
    );

    if (currentUser) {
      addLog(
        currentUser.id,
        currentUser.name,
        currentUser.role,
        'create_transaction',
        `Pencatatan Rekap Kas (${modalType === 'in' ? 'Kas Masuk' : 'Kas Keluar'}) sebesar ${formatRupiah(amount)} - ${finalCategory}`,
        { movementId: created.id, amount, type: modalType, category: finalCategory }
      );
    }

    setShowModal(false);
  };

  const openEditForm = (m: CashMovement) => {
    setEditingMovement(m);
    setEditType(m.type);
    setEditAmount(String(m.amount));
    const isStandardIn = CATEGORIES_IN.includes(m.category);
    const isStandardOut = CATEGORIES_OUT.includes(m.category);
    if (m.type === 'in' ? isStandardIn : isStandardOut) {
      setEditCategory(m.category);
      setEditCustomCategory('');
    } else {
      setEditCategory('Lain-lain');
      setEditCustomCategory(m.category);
    }
    setEditNotes(m.notes || '');
  };

  const handleRequestEdit = (m: CashMovement) => {
    if (currentUser?.role === 'Kasir') {
      setPendingAction({ type: 'edit', movement: m });
      setPinModalOpen(true);
    } else {
      openEditForm(m);
    }
  };

  const handleRequestDelete = (m: CashMovement) => {
    if (currentUser?.role === 'Kasir') {
      setPendingAction({ type: 'delete', movement: m });
      setPinModalOpen(true);
    } else {
      setDeleteId(m.id);
    }
  };

  const handlePinSuccess = () => {
    const action = pendingAction;
    setPinModalOpen(false);
    setPendingAction(null);
    if (action) {
      if (action.type === 'edit') {
        openEditForm(action.movement);
      } else if (action.type === 'delete') {
        setDeleteId(action.movement.id);
      }
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMovement) return;

    const amount = parseInt(editAmount) || 0;
    if (amount <= 0) {
      alert('Nominal harus lebih dari 0');
      return;
    }

    const finalCategory = editCategory === 'Lain-lain' && editCustomCategory ? editCustomCategory : editCategory;

    await updateMovement(editingMovement.id, {
      type: editType,
      amount,
      category: finalCategory,
      notes: editNotes,
    });

    if (currentUser) {
      addLog(
        currentUser.id,
        currentUser.name,
        currentUser.role,
        'update_cash_movement',
        `Perubahan Rekap Kas (${editType === 'in' ? 'Kas Masuk' : 'Kas Keluar'}) sebesar ${formatRupiah(amount)} - ${finalCategory}`,
        { movementId: editingMovement.id, amount, type: editType, category: finalCategory }
      );
    }

    setEditingMovement(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    const target = movements.find((m) => m.id === deleteId);
    await deleteMovement(deleteId);
    if (currentUser && target) {
      addLog(
        currentUser.id,
        currentUser.name,
        currentUser.role,
        'delete_cash_movement',
        `Pembatalan/Hapus Rekap Kas (${target.type === 'in' ? 'Kas Masuk' : 'Kas Keluar'}) sebesar ${formatRupiah(target.amount)} - ${target.category}`,
        { movementId: target.id, amount: target.amount, type: target.type }
      );
    }
    setDeleteId(null);
  };

  // Extract unique categories for filter
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    movements.forEach((m) => set.add(m.category));
    return Array.from(set);
  }, [movements]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
        <div className="w-full">
          <h1 className="text-2xl font-bold flex items-center justify-center sm:justify-start gap-2 w-full">
            <Wallet className="text-brand-600" size={28} />
            Rekap Kas (Arus Kas)
          </h1>
          <p className="text-xs text-slate-500 mt-1 text-center sm:text-left">
            Catat pengeluaran operasional (Kas Keluar) dan penambahan kas (Kas Masuk)
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-950/40 flex items-center justify-center text-green-600 dark:text-green-400">
            <TrendingUp size={24} />
          </div>
          <div>
            <p className="text-xs text-slate-500">Total Kas Masuk</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">
              {formatRupiah(totals.totalIn)}
            </p>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-950/40 flex items-center justify-center text-red-600 dark:text-red-400">
            <TrendingDown size={24} />
          </div>
          <div>
            <p className="text-xs text-slate-500">Total Kas Keluar</p>
            <p className="text-xl font-bold text-red-600 dark:text-red-400">
              {formatRupiah(totals.totalOut)}
            </p>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${totals.net >= 0 ? 'bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400' : 'bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400'}`}>
            <Wallet size={24} />
          </div>
          <div>
            <p className="text-xs text-slate-500">Arus Kas Bersih (Net)</p>
            <p className={`text-xl font-bold ${totals.net >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400'}`}>
              {totals.net >= 0 ? '+' : ''}{formatRupiah(totals.net)}
            </p>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="card p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Date Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-medium self-start sm:self-auto">
          <button
            onClick={() => setDateFilter('today')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${dateFilter === 'today' ? 'bg-white dark:bg-slate-700 text-brand-600 shadow-sm' : 'text-slate-500'}`}
          >
            Hari Ini
          </button>
          <button
            onClick={() => setDateFilter('week')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${dateFilter === 'week' ? 'bg-white dark:bg-slate-700 text-brand-600 shadow-sm' : 'text-slate-500'}`}
          >
            7 Hari
          </button>
          <button
            onClick={() => setDateFilter('month')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${dateFilter === 'month' ? 'bg-white dark:bg-slate-700 text-brand-600 shadow-sm' : 'text-slate-500'}`}
          >
            Bulan Ini
          </button>
          <button
            onClick={() => setDateFilter('all')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${dateFilter === 'all' ? 'bg-white dark:bg-slate-700 text-brand-600 shadow-sm' : 'text-slate-500'}`}
          >
            Semua
          </button>
        </div>

        {/* Search & Category Filter */}
        <div className="flex items-center gap-2">
          {allCategories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="input text-xs py-1.5 px-2"
            >
              <option value="all">Semua Kategori</option>
              {allCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}

          <div className="relative flex-1 sm:w-48">
            <Search className="absolute left-2.5 top-2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Cari transaksi kas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-8 py-1.5 text-xs"
            />
          </div>
        </div>
      </div>

      {/* History Table */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-bold text-sm">Riwayat Pencatatan Kas</h3>
          <span className="text-xs text-slate-400">{filteredMovements.length} entri</span>
        </div>

        {filteredMovements.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <FileText size={40} className="mx-auto opacity-30" />
            <p className="text-sm">Belum ada pencatatan kas pada periode ini</p>
            <p className="text-xs text-slate-400">Klik tombol "Catat Kas Masuk" atau "Catat Kas Keluar" di atas untuk menambah data</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="text-left p-3 font-semibold">Tanggal / Waktu</th>
                  <th className="text-left p-3 font-semibold">Kasir / User</th>
                  <th className="text-left p-3 font-semibold">Tipe</th>
                  <th className="text-left p-3 font-semibold">Kategori</th>
                  <th className="text-left p-3 font-semibold">Catatan / Keterangan</th>
                  <th className="text-right p-3 font-semibold">Nominal</th>
                  <th className="text-center p-3 font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredMovements.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-slate-50 dark:border-slate-700/40 hover:bg-slate-50/50 dark:hover:bg-slate-800/40"
                  >
                    <td className="p-3 text-xs text-slate-500">{formatDate(m.date)}</td>
                    <td className="p-3 font-medium">{m.cashierName}</td>
                    <td className="p-3">
                      {m.type === 'in' ? (
                        <span className="badge bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300 font-semibold">
                          + Kas Masuk
                        </span>
                      ) : (
                        <span className="badge bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300 font-semibold">
                          - Kas Keluar
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {m.category}
                    </td>
                    <td className="p-3 text-xs text-slate-600 dark:text-slate-400 max-w-xs truncate">
                      {m.notes || '-'}
                    </td>
                    <td className={`p-3 text-right font-bold ${m.type === 'in' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {m.type === 'in' ? '+' : '-'}{formatRupiah(m.amount)}
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleRequestEdit(m)}
                          className="p-1.5 rounded-lg text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          title="Ubah Entri Rekap Kas"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleRequestDelete(m)}
                          className="p-1.5 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          title="Batal / Hapus Entri"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Input Kas Masuk / Kas Keluar */}
      {showModal && (
        <Modal
          open={showModal}
          onClose={() => setShowModal(false)}
          title={modalType === 'in' ? '📥 Catat Kas Masuk (Pemasukan)' : '📤 Catat Kas Keluar (Pengeluaran)'}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Type indicator */}
            <div className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${modalType === 'in' ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'}`}>
              <AlertCircle size={16} />
              <span>
                {modalType === 'in'
                  ? 'Kas Masuk akan menambahkan saldo kas ekspektasi pada shift kasir aktif.'
                  : 'Kas Keluar akan mengurangkan saldo kas ekspektasi pada shift kasir aktif.'}
              </span>
            </div>

            {/* Nominal */}
            <div>
              <label className="label font-semibold">Nominal (Rp) *</label>
              <input
                type="number"
                min="1"
                step="any"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="input text-lg font-bold"
                placeholder="0"
                required
                autoFocus
              />
              {/* Quick Amount Buttons */}
              <div className="flex gap-2 mt-2">
                {[10000, 20000, 50000, 100000, 500000].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAmountInput(String(val))}
                    className="text-[11px] px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded font-medium"
                  >
                    +{formatRupiah(val)}
                  </button>
                ))}
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="label font-semibold">Kategori *</label>
              <select
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                className="input text-sm"
              >
                {(modalType === 'in' ? CATEGORIES_IN : CATEGORIES_OUT).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {categoryInput === 'Lain-lain' && (
              <div>
                <label className="label text-xs">Nama Kategori Kustom</label>
                <input
                  type="text"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  className="input text-xs"
                  placeholder="Ketik kategori kustom..."
                  required
                />
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="label font-semibold">Catatan / Keterangan Tambahan</label>
              <textarea
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                className="input text-xs h-20 py-2"
                placeholder="Contoh: Pembelian Es Batu 2 Plastik, Uang Modal dari Manager, dsb."
              />
            </div>

            {/* Submit */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="btn-secondary text-xs"
              >
                Batal
              </button>
              <button
                type="submit"
                className={`btn text-xs font-semibold px-4 py-2 text-white ${modalType === 'in' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                Simpan {modalType === 'in' ? 'Kas Masuk' : 'Kas Keluar'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Edit Rekap Kas */}
      {editingMovement && (
        <Modal
          open={!!editingMovement}
          onClose={() => setEditingMovement(null)}
          title="✏️ Ubah Pencatatan Kas"
        >
          <form onSubmit={handleEditSubmit} className="space-y-4">
            {/* Type selector */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditType('in');
                  setEditCategory(CATEGORIES_IN[0]);
                  setEditCustomCategory('');
                }}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all border ${editType === 'in' ? 'bg-green-600 text-white border-green-600 shadow-md' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 border-transparent'}`}
              >
                + Kas Masuk
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditType('out');
                  setEditCategory(CATEGORIES_OUT[0]);
                  setEditCustomCategory('');
                }}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all border ${editType === 'out' ? 'bg-red-600 text-white border-red-600 shadow-md' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 border-transparent'}`}
              >
                - Kas Keluar
              </button>
            </div>

            {/* Nominal */}
            <div>
              <label className="label font-semibold">Nominal (Rp) *</label>
              <input
                type="number"
                min="1"
                step="any"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                className="input text-lg font-bold"
                placeholder="0"
                required
              />
              {/* Quick Amount Buttons */}
              <div className="flex gap-2 mt-2">
                {[10000, 20000, 50000, 100000, 500000].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setEditAmount(String(val))}
                    className="text-[11px] px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded font-medium"
                  >
                    +{formatRupiah(val)}
                  </button>
                ))}
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="label font-semibold">Kategori *</label>
              <select
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                className="input text-sm"
              >
                {(editType === 'in' ? CATEGORIES_IN : CATEGORIES_OUT).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {editCategory === 'Lain-lain' && (
              <div>
                <label className="label text-xs">Nama Kategori Kustom</label>
                <input
                  type="text"
                  value={editCustomCategory}
                  onChange={(e) => setEditCustomCategory(e.target.value)}
                  className="input text-xs"
                  placeholder="Ketik kategori kustom..."
                  required
                />
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="label font-semibold">Catatan / Keterangan Tambahan</label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="input text-xs h-20 py-2"
                placeholder="Contoh: Pembelian Es Batu 2 Plastik..."
              />
            </div>

            {/* Submit */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingMovement(null)}
                className="btn-secondary text-xs"
              >
                Batal
              </button>
              <button
                type="submit"
                className="btn-primary text-xs font-semibold px-4 py-2"
              >
                Simpan Perubahan
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* PIN Verification Modal for Kasir */}
      <PinModal
        open={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false);
          setPendingAction(null);
        }}
        onSuccess={handlePinSuccess}
        title="Otorisasi PIN Manager"
      />

      {/* Confirm Delete Dialog */}
      {deleteId && (
        <ConfirmDialog
          open={!!deleteId}
          title="Hapus / Batal Pencatatan Kas"
          message="Apakah Anda yakin ingin menghapus entri rekap kas ini? Data yang dihapus tidak dapat dikembalikan."
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeleteId(null)}
        />
      )}

      {/* Floating Action Button (FAB) Speed Dial */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
        {/* Speed Dial Options */}
        {fabOpen && (
          <div className="flex flex-col items-end gap-2.5 animate-in fade-in slide-in-from-bottom-3 duration-200">
            {/* Backdrop to dismiss */}
            <div
              className="fixed inset-0 bg-slate-900/30 backdrop-blur-[1px] -z-10"
              onClick={() => setFabOpen(false)}
            />

            {/* Catat Kas Masuk */}
            <button
              onClick={() => {
                setFabOpen(false);
                handleOpenModal('in');
              }}
              className="btn bg-green-600 hover:bg-green-700 text-white font-semibold text-xs px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 transition-transform hover:scale-105 active:scale-95 border border-green-500/30"
            >
              <Plus size={18} /> Catat Kas Masuk
            </button>

            {/* Catat Kas Keluar */}
            <button
              onClick={() => {
                setFabOpen(false);
                handleOpenModal('out');
              }}
              className="btn bg-red-600 hover:bg-red-700 text-white font-semibold text-xs px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 transition-transform hover:scale-105 active:scale-95 border border-red-500/30"
            >
              <Minus size={18} /> Catat Kas Keluar
            </button>
          </div>
        )}

        {/* Main Floating Button */}
        <button
          onClick={() => setFabOpen(!fabOpen)}
          className={`w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-white transition-all duration-300 active:scale-95 border border-white/20 ${
            fabOpen
              ? 'bg-slate-800 dark:bg-slate-700 rotate-45 scale-105 ring-4 ring-slate-400/30'
              : 'bg-brand-600 hover:bg-brand-700 hover:scale-105 ring-4 ring-brand-500/20'
          }`}
          title={fabOpen ? 'Tutup' : 'Catat Rekap Kas'}
        >
          <Plus size={28} />
        </button>
      </div>
    </div>
  );
}
