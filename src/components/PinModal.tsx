import { useState } from 'react';
import Modal from './Modal';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { isApproverRole, type ApproverInfo } from '../utils/pinAuth';
import { ShieldAlert, UserCheck } from 'lucide-react';

interface PinModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (approver?: ApproverInfo) => void;
  title?: string;
  /**
   * v4.7 TO DO 10.2: true = otorisasi opname — hanya akun Manager/Owner yang bisa menyetujui.
   * - Sesi Manager → cukup PIN (identitas = currentUser).
   * - Sesi non-Manager (mis. Staf Gudang) → login cepat sebagai Manager (username + password);
   *   PIN global TIDAK cukup lagi (sebelumnya siapa pun yang tahu PIN bisa menyetujui).
   */
  requireManager?: boolean;
}

export default function PinModal({ open, onClose, onSuccess, title, requireManager = false }: PinModalProps) {
  const [pin, setPin] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { verifyPin } = useSettingsStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const verifyManagerCredentials = useAuthStore((s) => s.verifyManagerCredentials);

  // Sesi Manager/Owner → jalur PIN. Sesi lain + requireManager → login cepat Manager.
  const managerSession = isApproverRole(currentUser?.role);
  const quickLogin = requireManager && !managerSession;

  const resetFields = () => {
    setPin('');
    setUsername('');
    setPassword('');
    setError('');
  };

  const handleSubmit = () => {
    if (quickLogin) {
      // Kredensial akun Manager — bukan PIN global. Identitas approver terekam.
      const approver = verifyManagerCredentials(username.trim(), password);
      if (!approver) {
        setError('Username atau password salah, atau akun bukan Manager.');
        return;
      }
      resetFields();
      onSuccess({ id: approver.id, name: approver.name, role: approver.role });
      return;
    }
    if (verifyPin(pin)) {
      resetFields();
      // Sesi Manager yang sah — catat identitasnya sebagai approver.
      onSuccess(
        currentUser && isApproverRole(currentUser.role)
          ? { id: currentUser.id, name: currentUser.name, role: currentUser.role }
          : undefined
      );
    } else {
      setError('PIN salah. Coba lagi.');
    }
  };

  const handleClose = () => {
    resetFields();
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={title || 'Otorisasi Manager'} maxWidth="max-w-sm">
      <div className="text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
          <ShieldAlert className="text-amber-600" size={28} />
        </div>

        {quickLogin ? (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Tindakan ini memerlukan otorisasi Manager. Login dengan akun Manager untuk menyetujui
              (identitas Anda akan tercatat).
            </p>
            <div className="text-left space-y-3">
              <div>
                <label className="label">Username Manager</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && document.getElementById('pin-manager-password')?.focus()}
                  placeholder="Username"
                  className="input"
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Password Manager</label>
                <input
                  id="pin-manager-password"
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  placeholder="Password"
                  className="input"
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={handleClose} className="btn-secondary flex-1">
                Batal
              </button>
              <button onClick={handleSubmit} className="btn-primary flex-1" disabled={!username.trim() || !password}>
                <UserCheck size={14} /> Otorisasi
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Masukkan PIN Manager untuk melanjutkan tindakan ini.
            </p>
            <input
              type="password"
              maxLength={6}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ''));
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Masukkan PIN"
              className="input text-center text-2xl tracking-[0.5em] font-mono"
              autoFocus
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-3">
              <button onClick={handleClose} className="btn-secondary flex-1">
                Batal
              </button>
              <button onClick={handleSubmit} className="btn-primary flex-1" disabled={pin.length < 4}>
                Konfirmasi
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
