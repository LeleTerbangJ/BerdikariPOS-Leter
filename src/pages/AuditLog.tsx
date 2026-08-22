import { useState, useMemo } from 'react';
import { useAuditLogStore } from '../store/auditLogStore';
import { useToastStore } from '../store/toastStore';
import { formatDate } from '../utils/format';
import { Search, Shield, Download, Trash2 } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import PinModal from '../components/PinModal';

const actionLabels: Record<string, string> = {
  login: 'Login',
  logout: 'Logout',
  create_transaction: 'Buat Transaksi',
  void_transaction: 'Void Transaksi',
  delete_transaction: 'Hapus Transaksi',
  create_menu: 'Tambah Menu',
  update_menu: 'Edit Menu',
  delete_menu: 'Hapus Menu',
  toggle_menu: 'Toggle Menu',
  create_user: 'Tambah User',
  update_user: 'Edit User',
  delete_user: 'Hapus User',
  update_inventory: 'Update Inventaris',
  deduct_inventory: 'Deduct Inventaris',
  open_shift: 'Buka Shift',
  close_shift: 'Tutup Shift',
  force_close_shift: 'Tutup Paksa Shift',
  update_settings: 'Update Settings',
  create_promo: 'Tambah Promo',
  update_promo: 'Edit Promo',
  delete_promo: 'Hapus Promo',
  create_customer: 'Tambah Pelanggan',
  update_customer: 'Edit Pelanggan',
  delete_customer: 'Hapus Pelanggan',
};

const actionColors: Record<string, string> = {
  login: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  logout: 'bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300',
  create_transaction: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  void_transaction: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  delete_transaction: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  create_menu: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  update_menu: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  delete_menu: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  toggle_menu: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  create_user: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  delete_user: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  open_shift: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  close_shift: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
  force_close_shift: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
};

export default function AuditLog() {
  const { addToast } = useToastStore();
  const { logs, clearOldLogs, clearAllLogs } = useAuditLogStore();
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  const [page, setPage] = useState(1);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const perPage = 25;

  const handleClearConfirm = () => {
    setShowClearConfirm(false);
    setShowPinModal(true);
  };

  const handleClearSuccess = async () => {
    setShowPinModal(false);
    const ok = await clearAllLogs();
    if (ok) {
      // v4.7 TO DO 20.2: alert → toast
      addToast('✅ Semua log audit berhasil dihapus dari lokal dan cloud.', 'success');
    } else {
      addToast('⚠️ Log audit terhapus lokal, namun gagal menyinkronkan penghapusan ke cloud.', 'warning');
    }
    setPage(1);
  };

  const filtered = useMemo(() => {
    let list = logs;
    if (filterAction !== 'all') list = list.filter((l) => l.action === filterAction);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.userName.toLowerCase().includes(q) ||
          l.detail.toLowerCase().includes(q) ||
          l.action.includes(q)
      );
    }
    return list;
  }, [logs, filterAction, search]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const uniqueActions = [...new Set(logs.map((l) => l.action))];

  const handleExport = () => {
    const header = 'Waktu,User,Role,Aksi,Detail\n';
    const rows = filtered.map((l) =>
      [
        `"${formatDate(l.timestamp)}"`,
        `"${l.userName}"`,
        `"${l.userRole}"`,
        `"${actionLabels[l.action] || l.action}"`,
        `"${l.detail}"`,
      ].join(',')
    );
    const bom = '\uFEFF';
    const blob = new Blob([bom + header + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-log.csv';
    a.click();
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold flex items-center justify-center sm:justify-start gap-2 text-center sm:text-left w-full sm:w-auto">
          <Shield size={24} /> Audit Log
        </h1>
        <div className="grid grid-cols-3 sm:flex items-center gap-2 w-full sm:w-auto">
          <button onClick={handleExport} className="btn-secondary text-sm flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto">
            <Download size={14} /> Export
          </button>
          <button onClick={() => clearOldLogs(90)} className="btn-secondary text-sm flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto">
            Hapus &gt; 90 hari
          </button>
          <button onClick={() => setShowClearConfirm(true)} className="btn-secondary text-sm text-red-600 flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto">
            <Trash2 size={14} /> Hapus Semua
          </button>
        </div>
      </div>

      <div className="card p-3 mb-4">
        <p className="text-xs text-slate-500">
          Total: {logs.length} log tercatat • Menampilkan {filtered.length} hasil
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Cari user, detail..."
            className="input pl-9 text-sm"
          />
        </div>
        <select
          value={filterAction}
          onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
          className="input w-auto text-sm"
        >
          <option value="all">Semua Aksi</option>
          {uniqueActions.map((a) => (
            <option key={a} value={a}>{actionLabels[a] || a}</option>
          ))}
        </select>
      </div>

      {/* Log List */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-700 sticky top-0">
              <tr>
                <th className="text-left p-3 font-semibold">Waktu</th>
                <th className="text-left p-3 font-semibold">User</th>
                <th className="text-left p-3 font-semibold">Role</th>
                <th className="text-left p-3 font-semibold">Aksi</th>
                <th className="text-left p-3 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((log) => (
                <tr key={log.id} className="border-b border-slate-50 dark:border-slate-700/40 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  <td className="p-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(log.timestamp)}</td>
                  <td className="p-3 font-medium">{log.userName}</td>
                  <td className="p-3">
                    <span className={`badge ${
                      log.userRole === 'Manager' ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' :
                      log.userRole === 'Kasir' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' :
                      'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                    }`}>
                      {log.userRole}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`badge ${actionColors[log.action] || 'bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300'}`}>
                      {actionLabels[log.action] || log.action}
                    </span>
                  </td>
                  <td className="p-3 text-slate-600 dark:text-slate-400 text-xs max-w-[300px] truncate">{log.detail}</td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">Belum ada log</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t border-slate-100 dark:border-slate-700">
            <p className="text-xs text-slate-500">
              Hal {page}/{totalPages}
            </p>
            <div className="flex gap-1">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="btn-ghost text-xs px-2">←</button>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="btn-ghost text-xs px-2">→</button>
            </div>
          </div>
        )}
      </div>

      {/* Dialog Konfirmasi & Otorisasi PIN */}
      <ConfirmDialog
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearConfirm}
        title="Hapus Semua Log Audit"
        message="Apakah Anda yakin ingin menghapus SELURUH riwayat log audit? Tindakan ini akan menghapus log di perangkat lokal dan database cloud (Supabase) secara permanen."
        confirmText="Ya, Hapus Semua"
        cancelText="Batal"
        variant="danger"
      />

      <PinModal
        open={showPinModal}
        onClose={() => setShowPinModal(false)}
        onSuccess={handleClearSuccess}
        title="Otorisasi Hapus Log Audit"
      />
    </div>
  );
}
