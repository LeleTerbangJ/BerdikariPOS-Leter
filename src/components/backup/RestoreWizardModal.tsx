import { useState, useRef } from 'react';
import {
  Upload,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileCheck,
  ShieldCheck,
  Key,
  RotateCcw,
  Loader2,
  X,
  FileArchive,
  Info,
} from 'lucide-react';
import Modal from '../Modal';
import {
  BackupService,
  formatBytes,
  type BackupValidationResult,
  type RestorableBackupData,
} from '../../lib/backupService';
import { useToastStore } from '../../store/toastStore';

interface RestoreWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function RestoreWizardModal({ isOpen, onClose, onSuccess }: RestoreWizardModalProps) {
  const { addToast } = useToastStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<BackupValidationResult | null>(null);
  const [managerPin, setManagerPin] = useState('');
  const [pinError, setPinError] = useState('');
  // 7.2: mode restore — merge (tambah/perbarui) vs replace (snapshot penuh)
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');

  // Restore Execution Progress
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreStepText, setRestoreStepText] = useState('');
  const [restoreComplete, setRestoreComplete] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const handleReset = () => {
    setStep(1);
    setSelectedFile(null);
    setIsValidating(false);
    setValidationResult(null);
    setManagerPin('');
    setPinError('');
    setRestoreMode('merge');
    setIsRestoring(false);
    setRestoreProgress(0);
    setRestoreStepText('');
    setRestoreComplete(false);
    setRestoreError(null);
  };

  const handleClose = () => {
    if (isRestoring) return; // Block close during active restore
    handleReset();
    onClose();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const processFile = async (file: File) => {
    setSelectedFile(file);
    setStep(2);
    setIsValidating(true);
    setValidationResult(null);

    // Validate backup ZIP content and checksum
    const result = await BackupService.validateBackup(file);
    setIsValidating(false);
    setValidationResult(result);

    if (result.valid) {
      setTimeout(() => {
        setStep(3);
      }, 500);
    }
  };

  const handleStartRestore = async () => {
    if (!validationResult?.data) return;
    if (!managerPin.trim()) {
      setPinError('Masukkan PIN Manager untuk mengonfirmasi restorasi.');
      return;
    }
    setPinError('');

    // Safety checks
    const safety = BackupService.checkRestoreSafety();
    if (!safety.safe) {
      addToast(safety.reason || 'Restorasi diblokir karena alasan keamanan', 'error');
      return;
    }

    setStep(4);
    setIsRestoring(true);
    setRestoreProgress(5);
    setRestoreStepText('Menyiapkan proses restorasi...');

    const result = await BackupService.restoreBackup(
      validationResult.data,
      managerPin,
      (text, percent) => {
        setRestoreStepText(text);
        setRestoreProgress(percent);
      },
      restoreMode
    );

    setIsRestoring(false);

    if (result.success) {
      setRestoreComplete(true);
      addToast('Restorasi database berhasil dilakukan! 🎉', 'success');
      onSuccess();
    } else {
      setRestoreError(result.error || 'Gagal memulihkan database.');
      addToast(`Restorasi Gagal: ${result.error}`, 'error');
    }
  };

  return (
    <Modal open={isOpen} onClose={handleClose} title=" Wizard Restorasi Database (Restore)" maxWidth="max-w-2xl">
      <div className="space-y-6 py-2">
        {/* Wizard Steps Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700/60 pb-4">
          <div className="flex items-center gap-2">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step >= 1 ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-600'}`}>1</span>
            <span className={`text-xs font-semibold ${step === 1 ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}>Pilih File</span>
          </div>
          <div className="h-0.5 flex-1 bg-slate-200 dark:bg-slate-700 mx-2" />
          <div className="flex items-center gap-2">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step >= 2 ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-600'}`}>2</span>
            <span className={`text-xs font-semibold ${step === 2 ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}>Validasi</span>
          </div>
          <div className="h-0.5 flex-1 bg-slate-200 dark:bg-slate-700 mx-2" />
          <div className="flex items-center gap-2">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step >= 3 ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-600'}`}>3</span>
            <span className={`text-xs font-semibold ${step === 3 ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}>Ringkasan</span>
          </div>
          <div className="h-0.5 flex-1 bg-slate-200 dark:bg-slate-700 mx-2" />
          <div className="flex items-center gap-2">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step >= 4 ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-600'}`}>4</span>
            <span className={`text-xs font-semibold ${step === 4 ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}>Restorasi</span>
          </div>
        </div>

        {/* STEP 1: CHOOSE FILE */}
        {step === 1 && (
          <div className="space-y-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-brand-500 dark:hover:border-brand-400 rounded-2xl p-8 text-center cursor-pointer transition-colors bg-slate-50/50 dark:bg-slate-800/30 flex flex-col items-center justify-center gap-3"
            >
              <div className="w-14 h-14 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 flex items-center justify-center">
                <Upload size={28} />
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white text-base">Klik atau Unggah File Backup (.ZIP)</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Pilih file backup terenkripsi (misal: Backup_NamaToko_2026-07-27.zip)
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            <div className="p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
              <AlertTriangle size={18} className="flex-shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <p className="font-semibold">Peringatan Keamanan Restorasi:</p>
                <p className="mt-0.5 text-amber-700 dark:text-amber-400">
                  Proses restore akan memperbarui database dengan data dari file backup. Pastikan sesi shift kasir telah ditutup dan tidak ada transaksi pending sebelum melanjutkan.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: VALIDATING */}
        {step === 2 && (
          <div className="py-8 text-center space-y-4">
            {isValidating ? (
              <>
                <Loader2 size={40} className="animate-spin text-brand-600 dark:text-brand-400 mx-auto" />
                <h3 className="font-bold text-lg text-slate-900 dark:text-white">Memverifikasi File Backup...</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Mengecek struktur manifest, keutuhan checksum SHA-256, versi skema, dan integritas data file ZIP.
                </p>
              </>
            ) : validationResult && !validationResult.valid ? (
              <div className="space-y-4">
                <div className="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                  <XCircle size={32} />
                </div>
                <h3 className="font-bold text-lg text-rose-600 dark:text-rose-400">Validasi File Backup Gagal!</h3>
                <p className="text-sm text-slate-700 dark:text-slate-300 bg-rose-50 dark:bg-rose-950/30 p-4 rounded-xl border border-rose-200 dark:border-rose-900/40 max-w-lg mx-auto">
                  {validationResult.error}
                </p>
                <div className="pt-2">
                  <button onClick={handleReset} className="btn-secondary text-sm px-4 py-2">
                    Pilih File Lain
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* STEP 3: SUMMARY & PIN CHECK */}
        {step === 3 && validationResult?.manifest && (
          <div className="space-y-5">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <FileCheck size={24} />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">File Backup Valid & Terverifikasi</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Checksum SHA-256 cocok 100% dengan manifest</p>
                </div>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
                {validationResult.manifest.backupType}
              </span>
            </div>

            {/* Manifest & Entity Metadata Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-1">
                <span className="text-slate-400 block font-medium">Nama Toko:</span>
                <span className="font-bold text-slate-900 dark:text-white text-sm">{validationResult.manifest.restaurantName}</span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-1">
                <span className="text-slate-400 block font-medium">Tanggal Dibuat:</span>
                <span className="font-bold text-slate-900 dark:text-white">{new Date(validationResult.manifest.createdAt).toLocaleString('id-ID')}</span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-1">
                <span className="text-slate-400 block font-medium">Versi Aplikasi / Skema:</span>
                <span className="font-bold text-slate-900 dark:text-white">v{validationResult.manifest.appVersion} (Schema {validationResult.manifest.schemaVersion})</span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-1">
                <span className="text-slate-400 block font-medium">Ukuran File ZIP:</span>
                <span className="font-bold text-slate-900 dark:text-white">{selectedFile ? formatBytes(selectedFile.size) : '-'}</span>
              </div>
            </div>

            {/* Entities Count Table */}
            <div className="border border-slate-200 dark:border-slate-700/60 rounded-xl overflow-hidden text-xs">
              <div className="bg-slate-100 dark:bg-slate-800/80 px-4 py-2 font-bold text-slate-700 dark:text-slate-300">
                Rincian Entitas Data dalam File Backup:
              </div>
              <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-2 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
                  <span className="text-slate-400 block text-[11px]">Katalog Menu</span>
                  <span className="font-bold text-sm text-slate-900 dark:text-white">{validationResult.entityCounts?.menus || 0}</span>
                </div>
                <div className="p-2 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
                  <span className="text-slate-400 block text-[11px]">Bahan Baku</span>
                  <span className="font-bold text-sm text-slate-900 dark:text-white">{validationResult.entityCounts?.inventory || 0}</span>
                </div>
                <div className="p-2 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
                  <span className="text-slate-400 block text-[11px]">Transaksi</span>
                  <span className="font-bold text-sm text-slate-900 dark:text-white">{validationResult.entityCounts?.transactions || 0}</span>
                </div>
                <div className="p-2 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
                  <span className="text-slate-400 block text-[11px]">Pelanggan CRM</span>
                  <span className="font-bold text-sm text-slate-900 dark:text-white">{validationResult.entityCounts?.customers || 0}</span>
                </div>
              </div>
            </div>

            {/* Restore Mode Selection (7.2) */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200">Mode Restorasi:</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRestoreMode('merge')}
                  className={`p-3.5 rounded-xl border-2 text-left transition ${
                    restoreMode === 'merge'
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <p className="text-sm font-bold text-slate-900 dark:text-white">Merge</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Tambahkan/perbarui data dari backup. Data lain di cloud tetap dipertahankan.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setRestoreMode('replace')}
                  className={`p-3.5 rounded-xl border-2 text-left transition ${
                    restoreMode === 'replace'
                      ? 'border-rose-500 bg-rose-50 dark:bg-rose-900/20'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <p className="text-sm font-bold text-rose-600 dark:text-rose-400">Replace (Snapshot)</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Samakan cloud dengan isi backup — entitas yang tidak ada di backup akan dihapus permanen.
                  </p>
                </button>
              </div>
              {restoreMode === 'replace' && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl flex items-start gap-2">
                  <AlertTriangle size={16} className="text-rose-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-700 dark:text-rose-400">
                    <strong>Peringatan:</strong> Semua data di cloud yang tidak ada di file backup akan <strong>DIHAPUS</strong> (termasuk
                    {validationResult.manifest.backupType === 'MASTER_DATA'
                      ? ' transaksi & riwayat kas yang ada saat ini tidak ikut dihapus — hanya data master).'
                      : validationResult.manifest.backupType === 'TRANSACTION'
                        ? ' data master (menu/inventory/user) — hanya riwayat transaksi & kas yang disamakan).'
                        : ' transaksi, menu, inventory, hingga user yang tidak tercakup backup).'}
                    Membutuhkan koneksi online ke cloud. Tindakan ini permanen.
                  </p>
                </div>
              )}
            </div>

            {/* Manager PIN Confirmation */}
            <div className="p-4 bg-slate-100 dark:bg-slate-800/90 rounded-xl space-y-3">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Key size={16} className="text-brand-600 dark:text-brand-400" />
                Konfirmasi PIN Manager / Owner:
              </label>
              <input
                type="password"
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value)}
                placeholder="Masukkan PIN Manager"
                className="w-full input text-sm"
              />
              {pinError && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{pinError}</p>}
            </div>

            {/* Buttons */}
            <div className="flex justify-between items-center pt-2">
              <button onClick={handleReset} className="btn-secondary text-xs py-2 px-4">
                Batal / Pilih File Lain
              </button>
              <button
                onClick={handleStartRestore}
                className="btn-primary text-sm py-2.5 px-5 flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white"
              >
                <RotateCcw size={16} />
                Eksekusi Restorasi Sekarang
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: RESTORE PROGRESS & COMPLETE */}
        {step === 4 && (
          <div className="py-6 space-y-6">
            {!restoreComplete && !restoreError && (
              <div className="space-y-4 text-center">
                <Loader2 size={44} className="animate-spin text-brand-600 dark:text-brand-400 mx-auto" />
                <div>
                  <h3 className="font-bold text-lg text-slate-900 dark:text-white">Proses Restorasi Berlangsung...</h3>
                  <p className="text-xs text-brand-600 dark:text-brand-400 font-semibold mt-1">{restoreStepText}</p>
                </div>
                <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden max-w-md mx-auto">
                  <div
                    className="h-full bg-brand-600 transition-all duration-300 rounded-full"
                    style={{ width: `${restoreProgress}%` }}
                  />
                </div>
              </div>
            )}

            {restoreComplete && (
              <div className="text-center space-y-4 py-4">
                <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 size={40} />
                </div>
                <div>
                  <h3 className="font-bold text-xl text-slate-900 dark:text-white">Restorasi Database Sukses! 🎉</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1">
                    Seluruh entitas data telah dipulihkan secara berurutan. Disarankan untuk me-refresh aplikasi agar seluruh perubahan termuat sempurna.
                  </p>
                </div>
                <div className="pt-2">
                  <button
                    onClick={() => {
                      handleClose();
                      window.location.reload();
                    }}
                    className="btn-primary text-sm py-2.5 px-6"
                  >
                    Muat Ulang Halaman (Reload)
                  </button>
                </div>
              </div>
            )}

            {restoreError && (
              <div className="text-center space-y-4 py-4">
                <div className="w-16 h-16 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                  <XCircle size={40} />
                </div>
                <div>
                  <h3 className="font-bold text-xl text-rose-600 dark:text-rose-400">Restorasi Gagal!</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 max-w-md mx-auto mt-1 bg-rose-50 dark:bg-rose-950/30 p-3 rounded-lg border border-rose-200 dark:border-rose-900/40">
                    {restoreError}
                  </p>
                </div>
                <div className="pt-2">
                  <button onClick={handleReset} className="btn-secondary text-sm py-2 px-5">
                    Coba Lagi
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
