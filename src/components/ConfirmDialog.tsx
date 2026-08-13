import { useEffect, useState } from 'react';
import Modal from './Modal';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
  /**
   * v4.7 TO DO 12.1.3 / P-A1: bila diisi, user harus mengetik kata kunci ini persis
   * agar tombol konfirmasi aktif (mis. "HAPUS" untuk aksi destruktif).
   */
  requireKeyword?: string;
}

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Konfirmasi',
  message,
  confirmText = 'Ya, Lanjutkan',
  cancelText = 'Batal',
  variant = 'danger',
  requireKeyword,
}: ConfirmDialogProps) {
  const [keyword, setKeyword] = useState('');

  // Reset input kata kunci setiap modal dibuka/ditutup
  useEffect(() => {
    if (!open) setKeyword('');
  }, [open]);

  const locked = !!requireKeyword && keyword !== requireKeyword;

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-sm">
      <div className="text-center space-y-4">
        <div className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center ${
          variant === 'danger' ? 'bg-red-100' : 'bg-amber-100'
        }`}>
          <AlertTriangle className={variant === 'danger' ? 'text-red-600' : 'text-amber-600'} size={28} />
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
        {requireKeyword && (
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={`Ketik "${requireKeyword}" untuk konfirmasi`}
            className="input text-sm text-center font-mono tracking-widest"
            autoFocus
          />
        )}
        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">
            {cancelText}
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            disabled={locked}
            className={`flex-1 ${variant === 'danger' ? 'btn-danger' : 'btn-primary'} ${locked ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
