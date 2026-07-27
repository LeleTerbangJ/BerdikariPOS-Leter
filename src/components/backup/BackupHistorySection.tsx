import { useState } from 'react';
import { History, Trash2, CheckCircle2, AlertCircle, FileArchive, HardDrive } from 'lucide-react';
import { useBackupStore } from '../../store/backupStore';
import ConfirmDialog from '../ConfirmDialog';

export default function BackupHistorySection() {
  const { history, clearHistory } = useBackupStore();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2">
            <History size={20} className="text-brand-600 dark:text-brand-400" />
            Riwayat Backup Database (History)
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Daftar histori metadata backup yang pernah dibuat di perangkat ini.
          </p>
        </div>
        {history.length > 0 && (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400 font-semibold flex items-center gap-1 py-1 px-2.5 rounded-lg border border-rose-200 dark:border-rose-900/40 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
          >
            <Trash2 size={14} /> Clear Log
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="text-center py-8 text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          <HardDrive size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">Belum ada riwayat backup yang tercatat.</p>
          <p className="text-xs mt-1">Buat backup baru di bagian atas untuk memulai penyimpanan histori.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">
              <tr>
                <th className="px-4 py-3">Tanggal & Waktu</th>
                <th className="px-4 py-3">Tipe Backup</th>
                <th className="px-4 py-3">Nama File</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Ukuran</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {history.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {new Date(entry.date).toLocaleString('id-ID')}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                      {entry.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <FileArchive size={14} className="text-brand-500" />
                      <span>{entry.filename}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {entry.status === 'Success' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                        <CheckCircle2 size={14} /> Sukses
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold">
                        <AlertCircle size={14} /> Gagal
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                    {entry.size}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Clear Confirmation Dialog */}
      <ConfirmDialog
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          clearHistory();
          setShowClearConfirm(false);
        }}
        title="Bersihkan Riwayat Backup?"
        message="Apakah Anda yakin ingin menghapus seluruh log histori backup dari perangkat ini? File backup fisik di penyimpanan lokal Anda tidak akan terhapus."
        confirmText="Ya, Hapus Histori"
        variant="danger"
      />
    </div>
  );
}
