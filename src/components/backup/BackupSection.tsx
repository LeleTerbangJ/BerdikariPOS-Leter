import { useState } from 'react';
import { Download, Database, Shield, CheckCircle2, AlertCircle, FileArchive, Check } from 'lucide-react';
import { BackupService, formatBytes } from '../../lib/backupService';
import type { BackupType } from '../../store/backupStore';
import { useToastStore } from '../../store/toastStore';

export default function BackupSection() {
  const { addToast } = useToastStore();
  const [selectedType, setSelectedType] = useState<BackupType>('FULL');
  const [includeAuditLogs, setIncludeAuditLogs] = useState(true);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupProgress, setBackupProgress] = useState(0);

  const handleCreateBackup = async () => {
    setIsBackingUp(true);
    setBackupProgress(20);

    try {
      setBackupProgress(50);
      const result = await BackupService.createBackup(selectedType, { includeAuditLogs });
      setBackupProgress(90);

      // Trigger file download
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);

      setBackupProgress(100);
      addToast(`Backup (${selectedType}) berhasil diunduh! (${formatBytes(result.sizeBytes)})`, 'success');
    } catch (err: any) {
      console.error('Backup creation error:', err);
      addToast(`Gagal membuat backup: ${err.message || 'Error tidak dikenal'}`, 'error');
    } finally {
      setTimeout(() => {
        setIsBackingUp(false);
        setBackupProgress(0);
      }, 600);
    }
  };

  return (
    <div className="card p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Download size={20} className="text-brand-600 dark:text-brand-400" />
            Buat Backup Database
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Pilih mode backup data untuk mengamankan seluruh informasi toko dalam format file ZIP terenkripsi.
          </p>
        </div>
      </div>

      {/* Backup Modes Selection */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Full Backup */}
        <div
          onClick={() => setSelectedType('FULL')}
          className={`relative cursor-pointer p-4 rounded-xl border-2 transition-all flex flex-col justify-between ${
            selectedType === 'FULL'
              ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-950/20 dark:border-brand-500'
              : 'border-slate-200 hover:border-slate-300 dark:border-slate-700/60 dark:hover:border-slate-600'
          }`}
        >
          {selectedType === 'FULL' && (
            <div className="absolute top-3 right-3 text-brand-600 dark:text-brand-400">
              <CheckCircle2 size={20} />
            </div>
          )}
          <div>
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
              <FileArchive size={20} />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white">FULL BACKUP</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Seluruh data toko lengkap: Pengaturan, Pengguna, Katalog Menu, Resep/BOM, Inventaris, Transaksi, Kas, Shifts & Media.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Rekomendasi Utama (Lengkap)
          </div>
        </div>

        {/* Master Data */}
        <div
          onClick={() => setSelectedType('MASTER_DATA')}
          className={`relative cursor-pointer p-4 rounded-xl border-2 transition-all flex flex-col justify-between ${
            selectedType === 'MASTER_DATA'
              ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-950/20 dark:border-brand-500'
              : 'border-slate-200 hover:border-slate-300 dark:border-slate-700/60 dark:hover:border-slate-600'
          }`}
        >
          {selectedType === 'MASTER_DATA' && (
            <div className="absolute top-3 right-3 text-brand-600 dark:text-brand-400">
              <CheckCircle2 size={20} />
            </div>
          )}
          <div>
            <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
              <Database size={20} />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white">MASTER DATA</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Hanya konfigurasi toko, produk menu, resep bahan baku, harga, pengguna & promo. (Tanpa histori riwayat transaksi).
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Untuk Setup Outlet Baru
          </div>
        </div>

        {/* Transaction Backup */}
        <div
          onClick={() => setSelectedType('TRANSACTION')}
          className={`relative cursor-pointer p-4 rounded-xl border-2 transition-all flex flex-col justify-between ${
            selectedType === 'TRANSACTION'
              ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-950/20 dark:border-brand-500'
              : 'border-slate-200 hover:border-slate-300 dark:border-slate-700/60 dark:hover:border-slate-600'
          }`}
        >
          {selectedType === 'TRANSACTION' && (
            <div className="absolute top-3 right-3 text-brand-600 dark:text-brand-400">
              <CheckCircle2 size={20} />
            </div>
          )}
          <div>
            <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3">
              <Shield size={20} />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white">TRANSAKSI SAJA</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Hanya riwayat penjualan, items transaksi, rekap kas masuk/keluar, shifts kasir & mutasi opname stok.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Arsip Penjualan Periodik
          </div>
        </div>
      </div>

      {/* Additional Options */}
      {selectedType === 'FULL' && (
        <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
          <input
            type="checkbox"
            id="includeAuditLogs"
            checked={includeAuditLogs}
            onChange={(e) => setIncludeAuditLogs(e.target.checked)}
            className="w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
          />
          <label htmlFor="includeAuditLogs" className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            Sertakan Riwayat Audit Log Sistem (Jejak Aktivitas Kasir & Manager)
          </label>
        </div>
      )}

      {/* Progress Bar during Backup */}
      {isBackingUp && (
        <div className="space-y-1.5 animate-fade-in">
          <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
            <span>Membuat file kompresi backup (.ZIP)...</span>
            <span>{backupProgress}%</span>
          </div>
          <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-600 transition-all duration-300 rounded-full"
              style={{ width: `${backupProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Submit Button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleCreateBackup}
          disabled={isBackingUp}
          className="btn-primary text-sm py-2.5 px-5 flex items-center gap-2 shadow-md hover:shadow-lg transition-all"
        >
          <Download size={18} />
          {isBackingUp ? 'Memproses Backup...' : `Unduh Backup (${selectedType})`}
        </button>
      </div>
    </div>
  );
}
