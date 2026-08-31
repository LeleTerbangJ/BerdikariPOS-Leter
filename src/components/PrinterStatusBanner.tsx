/**
 * PrinterStatusBanner — Slim status bar shown at the top of the app
 * when Bluetooth printers are configured. Shows connection state and
 * provides one-click reconnect buttons.
 * 
 * States:
 * - All connected:  Green bar — "Semua Printer Terhubung" (auto-hides after 5s)
 * - Some offline:   Amber bar — "[Printer Name] Offline [Hubungkan]"
 * - All offline:    Red bar   — "N Printer Tidak Terhubung [Hubungkan]"
 *
 * Satu tombol per printer yang terputus (mis. BARISTA / DAPUR / KASIR) — tidak ada
 * tombol "Sambungkan Semua" agar setiap tombol menghubungkan printer ke dapurnya sendiri.
 */

import { useState, useEffect, useRef } from 'react';
import { usePrinterMonitor } from '../hooks/usePrinterMonitor';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';
import { isPrinterSessionRecent } from '../utils/printer';
import { buildReconnectButtonPlan } from '../utils/reconnectPlan';
import { Printer, Wifi, WifiOff, RefreshCw, CheckCircle, X } from 'lucide-react';

export default function PrinterStatusBanner() {
  const { currentUser } = useAuthStore();
  const { status, reconnect, reconnectAll } = usePrinterMonitor();
  const addToast = useToastStore((s) => s.addToast);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  // R-B1: state terpisah untuk fallback "Sambungkan Semua" (cap >3 printer offline)
  const [reconnectingAll, setReconnectingAll] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // R-B2: dismiss eksplisit untuk banner offline netral (printer rusak / permanen
  // offline) — "Sembunyikan sesi ini" sampai reload atau semua printer tersambung lagi.
  // Terpisah dari `dismissed` (toast sukses) agar putus berikutnya tidak membatalkannya.
  const [dismissedOffline, setDismissedOffline] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 🏷️ v4.9: Banner hanya muncul untuk user level Manager dan Kasir (tidak untuk Acaraki / Staf Dapur / Staf Gudang)
  const allowedRoles = ['Manager', 'Kasir'];
  if (!currentUser || !allowedRoles.includes(currentUser.role)) {
    return null;
  }

  // TO DO 14.1 P-2/P-4 + R-B2: setelah page refresh, printer yang tadinya tersambung otomatis
  // terputus (koneksi Web Bluetooth in-memory). Tampilkan banner reconnect AGRESIF (tidak bisa
  // di-dismiss) sampai pengguna menekan "Sambungkan Ulang" — karena re-pair senyap via
  // getDevices() mungkin butuh user gesture.
  // R-B2: klasifikasi PENYEBAB — putus dianggap "akibat refresh" HANYA bila printer tercatat
  // tersambung BARU SAJA (connectedAt dalam jendela PRINTER_SESSION_REFRESH_WINDOW_MS).
  // Sesi lama (printer mati listrik / kehilangan jarak di tengah shift) → pesan netral
  // "terputus" + bisa di-dismiss (tidak menyesatkan, tidak mengunci banner selamanya).
  const refreshCaused =
    status.active &&
    !status.allConnected &&
    status.offlinePrinters.some((p) => isPrinterSessionRecent(p.id));

  const handleReconnectSingle = async (printerId: string) => {
    if (reconnectingAll) return; // jangan tumpang tindih dengan koneksi massal
    const printerName = status.offlinePrinters.find((p) => p.id === printerId)?.name || 'Printer';
    setReconnecting(printerId);
    try {
      const success = await reconnect(printerId);
      if (!success) {
        addToast(`Gagal menyambungkan ${printerName}. Pastikan printer menyala dan dalam jangkauan.`, 'error', 5000);
      }
    } finally {
      setReconnecting(null);
    }
  };

  // R-B1: fallback massal bila lebih dari RECONNECT_BUTTON_CAP printer offline
  const handleReconnectAll = async () => {
    if (reconnecting !== null || reconnectingAll) return;
    setReconnectingAll(true);
    try {
      const anySuccess = await reconnectAll();
      if (!anySuccess) {
        addToast('Gagal menyambungkan semua printer. Pastikan printer menyala dan dalam jangkauan.', 'error', 5000);
      }
    } finally {
      setReconnectingAll(false);
    }
  };

  // R-B1: cap tombol per-printer (≤3) + fallback "Sambungkan Semua";
  // R-B3: disabled PER-ID — hanya tombol printer yang sedang menghubungkan yang nonaktif.
  const plan = buildReconnectButtonPlan(status.offlinePrinters, reconnecting, reconnectingAll);
  const renderReconnectButtons = () => (
    <>
      {plan.buttons.map((p) => (
        <button
          key={p.id}
          onClick={() => handleReconnectSingle(p.id)}
          disabled={p.disabled}
          className="printer-banner__btn"
          title={`Hubungkan ${p.name}`}
        >
          <RefreshCw size={12} className={reconnecting === p.id ? 'animate-spin' : ''} />
          <span>{reconnecting === p.id ? 'Menghubungkan...' : p.name.replace('Printer ', '')}</span>
        </button>
      ))}
      {plan.showAllButton && (
        <button
          onClick={handleReconnectAll}
          disabled={plan.allDisabled}
          className="printer-banner__btn"
          title="Sambungkan semua printer yang terputus"
        >
          <RefreshCw size={12} className={reconnectingAll ? 'animate-spin' : ''} />
          <span>
            {reconnectingAll ? 'Menghubungkan...' : `Sambungkan Semua (${plan.allCount})`}
          </span>
        </button>
      )}
    </>
  );

  // When all printers become connected, show success briefly then auto-hide
  useEffect(() => {
    if (status.allConnected && status.active) {
      setDismissed(false);
      setDismissedOffline(false);
      // T-2: reset stale state reconnectingAll bila semua printer tersambung
      // selama iterasi "Sambungkan Semua" (edge case: banner sukses tampil
      // bersama spinner tersisa <1 detik sampai promise resolve).
      setReconnectingAll(false);
      setShowSuccess(true);
      successTimerRef.current = setTimeout(() => {
        setShowSuccess(false);
      }, 4000);
    } else {
      setShowSuccess(false);
      if (status.totalDisconnected > 0) {
        setDismissed(false);
      }
    }

    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, [status.allConnected, status.active, status.totalDisconnected]);

  // Don't render if no bluetooth printers configured
  if (!status.active) return null;

  // Don't render if dismissed and all connected
  if (dismissed) return null;

  // All connected — success state
  if (status.allConnected && showSuccess) {
    return (
      <div className="printer-banner printer-banner--success">
        <div className="flex items-center gap-2">
          <CheckCircle size={14} className="flex-shrink-0" />
          <Printer size={14} className="flex-shrink-0" />
          <span className="text-xs font-medium">
            Semua Printer Terhubung ({status.totalConnected})
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-0.5 rounded hover:bg-green-200/50 dark:hover:bg-green-800/50 transition"
          title="Tutup"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  // All connected but success toast already hidden
  if (status.allConnected && !showSuccess) return null;

  // R-B2: putus NON-refresh (sesi lama / tidak ada entri sesi) bisa di-dismiss —
  // printer rusak tidak boleh mengunci banner selamanya.
  if (dismissedOffline) return null;

  // TO DO 14.1 P-4 + R-B2 (hanya bila penyebabnya refresh): banner agresif, tidak bisa di-dismiss
  if (refreshCaused) {
    return (
      <div className="printer-banner printer-banner--error">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <RefreshCw size={14} className="flex-shrink-0" />
          <Printer size={14} className="flex-shrink-0" />
          <span className="text-xs font-medium truncate">
            {status.totalDisconnected === 1
              ? `Refresh memutus koneksi ${status.offlinePrinters[0].name} — klik untuk menyambungkan kembali`
              : `Refresh memutus koneksi printer — klik untuk menyambungkan kembali`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
          {renderReconnectButtons()}
        </div>
      </div>
    );
  }

  // Some or all offline
  const allOffline = status.totalDisconnected === status.totalConfigured;

  return (
    <div className={`printer-banner ${allOffline ? 'printer-banner--error' : 'printer-banner--warning'}`}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <WifiOff size={14} className="flex-shrink-0" />
        <Printer size={14} className="flex-shrink-0" />
        <span className="text-xs font-medium truncate">
          {status.totalDisconnected === 1
            ? `${status.offlinePrinters[0].name} Offline`
            : `${status.totalDisconnected} Printer Tidak Terhubung`}
        </span>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
        {renderReconnectButtons()}
        {/* R-B2: dismiss eksplisit untuk banner offline netral */}
        <button
          onClick={() => setDismissedOffline(true)}
          className="p-0.5 rounded hover:bg-red-200/50 dark:hover:bg-red-800/50 transition"
          title="Sembunyikan sesi ini (printer rusak / tidak akan disambungkan)"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
