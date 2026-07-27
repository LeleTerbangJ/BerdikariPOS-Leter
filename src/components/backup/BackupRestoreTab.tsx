import { useState } from 'react';
import { RotateCcw, ShieldCheck, Database, HardDriveDownload } from 'lucide-react';
import BackupSection from './BackupSection';
import BackupHistorySection from './BackupHistorySection';
import AutoBackupSection from './AutoBackupSection';
import RestoreWizardModal from './RestoreWizardModal';
import { useAuthStore } from '../../store/authStore';

export default function BackupRestoreTab() {
  const { currentUser } = useAuthStore();
  const [showRestoreWizard, setShowRestoreWizard] = useState(false);

  // Access restriction: Only Manager or Owner can perform backup & restore
  const canAccess = currentUser?.role === 'Manager';

  if (!canAccess) {
    return (
      <div className="card p-8 text-center space-y-3">
        <ShieldCheck size={40} className="mx-auto text-amber-500 opacity-80" />
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Akses Dibatasi</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          Fitur Backup & Restore Database hanya dapat diakses oleh akun berkewenangan Manager atau Pemilik Toko.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner Action to Trigger Restore */}
      <div className="card p-5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-brand-500/20 border border-brand-400/30 flex items-center justify-center text-brand-400 flex-shrink-0">
            <HardDriveDownload size={26} />
          </div>
          <div>
            <h2 className="font-bold text-base text-white">Manajemen Cadangan & Pemulihan Data (Backup & Restore)</h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Amankan seluruh database toko Anda atau pulihkan data dari file pencadangan (.ZIP) secara aman.
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowRestoreWizard(true)}
          className="btn-primary bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl flex items-center gap-2 shadow-md hover:shadow-lg transition-all flex-shrink-0"
        >
          <RotateCcw size={16} /> Restore Database (Wizard)
        </button>
      </div>

      {/* Section 1: Backup Options */}
      <BackupSection />

      {/* Section 2 & Modal: Restore Wizard */}
      <RestoreWizardModal
        isOpen={showRestoreWizard}
        onClose={() => setShowRestoreWizard(false)}
        onSuccess={() => {
          // Success callback
        }}
      />

      {/* Section 3: Backup History */}
      <BackupHistorySection />

      {/* Section 4: Auto Backup Config */}
      <AutoBackupSection />
    </div>
  );
}
