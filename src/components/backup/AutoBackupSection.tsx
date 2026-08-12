import { useState } from 'react';
import { CalendarClock, Cloud, HardDrive, Check, Lock, Save } from 'lucide-react';
import { useBackupStore } from '../../store/backupStore';
import { useToastStore } from '../../store/toastStore';

export default function AutoBackupSection() {
  const { addToast } = useToastStore();
  const { autoBackupConfig, updateAutoBackupConfig, lastAutoBackupAt } = useBackupStore();

  const [frequency, setFrequency] = useState(autoBackupConfig.frequency);
  const [destination, setDestination] = useState(autoBackupConfig.destination);
  const [targetTime, setTargetTime] = useState(autoBackupConfig.targetTime || '23:00');
  const [includeAuditLogs, setIncludeAuditLogs] = useState(autoBackupConfig.includeAuditLogs !== false);

  const handleSaveConfig = () => {
    updateAutoBackupConfig({
      frequency,
      destination,
      targetTime,
      includeAuditLogs,
    });
    addToast('Pengaturan Auto Backup berhasil disimpan!', 'success');
  };

  return (
    <div className="card p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <CalendarClock size={20} className="text-brand-600 dark:text-brand-400" />
              Pengaturan Auto Backup Otomatis
            </h2>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                autoBackupConfig.frequency !== 'OFF'
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
              }`}
            >
              {autoBackupConfig.frequency !== 'OFF' ? '● Otomatis Aktif' : 'Nonaktif'}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Konfigurasi penjadwalan otomatis untuk pencadangan berkala tanpa intervensi manual.
          </p>
          {lastAutoBackupAt && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              Terakhir backup otomatis: {new Date(lastAutoBackupAt).toLocaleString('id-ID')}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Frekuensi Penjadwalan */}
        <div className="space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Frekuensi Auto Backup
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setFrequency('OFF')}
              className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                frequency === 'OFF'
                  ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Nonaktif (OFF)
            </button>
            <button
              type="button"
              onClick={() => setFrequency('Daily')}
              className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                frequency === 'Daily'
                  ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Harian (Daily)
            </button>
            <button
              type="button"
              onClick={() => setFrequency('Weekly')}
              className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                frequency === 'Weekly'
                  ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Mingguan (Weekly)
            </button>
          </div>

          {frequency !== 'OFF' && (
            <div className="pt-2 flex items-center gap-3">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Jam Eksekusi:</label>
              <input
                type="time"
                value={targetTime}
                onChange={(e) => setTargetTime(e.target.value)}
                className="input text-xs py-1.5 px-3 w-32"
              />
            </div>
          )}
        </div>

        {/* Lokasi Destinasi Penyimpanan */}
        <div className="space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Lokasi Destinasi Penyimpanan
          </label>
          <div className="space-y-2 text-xs">
            {/* Local Download */}
            <div
              onClick={() => setDestination('Local Download')}
              className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                destination === 'Local Download'
                  ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-950/20 text-brand-900 dark:text-brand-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <HardDrive size={18} className="text-brand-600 dark:text-brand-400" />
                <div>
                  <p className="font-bold">Local Download (Perangkat)</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Unduh otomatis file ZIP ke folder unduhan browser</p>
                </div>
              </div>
              {destination === 'Local Download' && <Check size={16} className="text-brand-600 dark:text-brand-400 font-bold" />}
            </div>

            {/* Supabase Storage */}
            <div
              onClick={() => setDestination('Supabase Storage')}
              className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                destination === 'Supabase Storage'
                  ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-950/20 text-brand-900 dark:text-brand-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Cloud size={18} className="text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="font-bold">Supabase Cloud Storage</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Simpan otomatis ke bucket penyimpanan cloud Supabase</p>
                </div>
              </div>
              {destination === 'Supabase Storage' && <Check size={16} className="text-brand-600 dark:text-brand-400 font-bold" />}
            </div>

            {/* Google Drive (Future Feature) */}
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/40 text-slate-400 dark:text-slate-500 flex items-center justify-between opacity-75 cursor-not-allowed">
              <div className="flex items-center gap-2.5">
                <Cloud size={18} />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold">Google Drive</p>
                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      Masa Depan
                    </span>
                  </div>
                  <p className="text-[11px]">Integrasi Google Drive OAuth2 (Coming Soon)</p>
                </div>
              </div>
              <Lock size={14} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
        <button
          onClick={handleSaveConfig}
          className="btn-primary text-sm py-2 px-5 flex items-center gap-2"
        >
          <Save size={16} /> Simpan Pengaturan Auto Backup
        </button>
      </div>
    </div>
  );
}
