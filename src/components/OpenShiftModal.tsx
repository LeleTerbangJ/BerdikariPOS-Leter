import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal';
import { useShiftStore } from '../store/shiftStore';
import { useAuthStore } from '../store/authStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { formatRupiah } from '../utils/format';
import { Wallet, ArrowRight } from 'lucide-react';
import { fetchShiftsFromCloud } from '../lib/cloudSync';
import type { CashierShift } from '../types';

interface OpenShiftModalProps {
  open: boolean;
}

export default function OpenShiftModal({ open }: OpenShiftModalProps) {
  const [cashInput, setCashInput] = useState('');
  const [existingShift, setExistingShift] = useState<CashierShift | null>(null);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();
  const { openShift, resumeExistingShift } = useShiftStore();
  const { currentUser } = useAuthStore();
  const { addLog } = useAuditLogStore();

  // v4.7 TO DO 18.3: 1 shift aktif per outlet — sebelum menawarkan input modal kas,
  // cek apakah sudah ada shift terbuka (lokal hasil loadFromCloud, lalu verifikasi
  // cloud untuk device baru). Bila ada → tawarkan "Lanjutkan Shift" (tanpa input
  // modal kas ulang) alih-alih membuka shift baru yang membuat 2 shift "aktif".
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setChecking(true);
    (async () => {
      let found: CashierShift | null =
        useShiftStore.getState().shifts.find((s) => s.status === 'open') ?? null;
      if (!found) {
        try {
          const cloud = await fetchShiftsFromCloud();
          if (!cancelled) {
            found = cloud?.find((s) => s.status === 'open') ?? null;
          }
        } catch {
          // Offline — tidak bisa verifikasi; lanjut form biasa (1 shift per device).
        }
      }
      if (!cancelled) {
        setExistingShift(found);
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleOpen = async () => {
    if (!currentUser) return;
    const amount = parseInt(cashInput) || 0;
    const res = await openShift(currentUser.id, currentUser.name, amount);
    if (!res.ok) {
      // Race: shift dibuka device lain saat modal terbuka — alihkan ke lanjut shift.
      setExistingShift(res.existing);
      return;
    }
    addLog(currentUser.id, currentUser.name, currentUser.role, 'open_shift', `Buka shift dengan modal ${formatRupiah(amount)}`, { openingCash: amount });
    setCashInput('');
  };

  const handleResume = () => {
    if (!existingShift || !currentUser) return;
    resumeExistingShift(existingShift);
    addLog(
      currentUser.id,
      currentUser.name,
      currentUser.role,
      'resume_shift',
      `Melanjutkan shift yang dibuka ${existingShift.userName} pukul ${new Date(existingShift.openedAt).toLocaleString('id-ID')} (1 shift per outlet)`,
      { shiftId: existingShift.id, openedBy: existingShift.userName }
    );
    setExistingShift(null);
    setCashInput('');
  };

  return (
    <Modal open={open} onClose={() => {}} title="Buka Shift Kasir" dismissible={false}>
      {existingShift ? (
        <div className="space-y-5">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-brand-100 flex items-center justify-center mb-3">
              <Wallet className="text-brand-600" size={32} />
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Shift sudah <strong>aktif</strong> di outlet ini — dibuka oleh{' '}
              <strong>{existingShift.userName}</strong> pada{' '}
              {new Date(existingShift.openedAt).toLocaleString('id-ID')}.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Sesuai kebijakan <strong>1 shift aktif per outlet</strong>, Anda akan
              melanjutkan shift tersebut (modal kas tidak diinput ulang — laci sudah berisi kas).
            </p>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 rounded-xl p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-blue-700 dark:text-blue-300">Kasir Pembuka</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">{existingShift.userName}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-blue-700 dark:text-blue-300">Dibuka Pukul</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {new Date(existingShift.openedAt).toLocaleTimeString('id-ID')}
              </span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-blue-700 dark:text-blue-300">Modal Awal</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">{formatRupiah(existingShift.openingCash)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={handleResume}
              className="btn-primary w-full text-base"
            >
              <ArrowRight size={18} /> Lanjutkan Shift Ini
            </button>
            {currentUser?.role === 'Manager' && (
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="w-full btn-secondary text-base py-2.5"
              >
                Batal & Kembali ke Dashboard
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-brand-100 flex items-center justify-center mb-3">
              <Wallet className="text-brand-600" size={32} />
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Selamat datang, <strong>{currentUser?.name}</strong>!<br />
              Masukkan jumlah modal kas awal di laci untuk memulai shift.
            </p>
            {checking && (
              <p className="text-xs text-slate-400 mt-2 animate-pulse">
                Memeriksa shift aktif di perangkat lain…
              </p>
            )}
          </div>

          <div>
            <label className="label">Modal Kas Awal (Rp)</label>
            <input
              type="text"
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value.replace(/\D/g, ''))}
              placeholder="Contoh: 200000"
              className="input text-lg font-semibold text-center"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && cashInput && handleOpen()}
            />
            {cashInput && (
              <p className="text-center text-sm text-brand-600 mt-2 font-medium">
                {formatRupiah(parseInt(cashInput) || 0)}
              </p>
            )}
          </div>

          {/* Quick amount buttons */}
          <div className="grid grid-cols-3 gap-2">
            {[100000, 200000, 300000, 500000, 750000, 1000000].map((v) => (
              <button
                key={v}
                onClick={() => setCashInput(String(v))}
                className="btn-secondary text-xs py-2"
              >
                {formatRupiah(v)}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <button
              onClick={handleOpen}
              className="btn-primary w-full text-base"
              disabled={!cashInput || parseInt(cashInput) <= 0}
            >
              <Wallet size={18} /> Mulai Shift
            </button>
            {currentUser?.role === 'Manager' && (
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="w-full btn-secondary text-base py-2.5"
              >
                Batal & Kembali ke Dashboard
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
