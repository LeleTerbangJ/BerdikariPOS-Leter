/**
 * PrinterStatusBanner — Slim status bar shown at the top of the app
 * when Bluetooth printers are configured. Shows connection state and
 * provides one-click reconnect buttons.
 * 
 * States:
 * - All connected:  Green bar — "Semua Printer Terhubung" (auto-hides after 5s)
 * - Some offline:   Amber bar — "[Printer Name] Offline [Reconnect]"
 * - All offline:    Red bar   — "N Printer Tidak Terhubung [Reconnect Semua]"
 */

import { useState, useEffect, useRef } from 'react';
import { usePrinterMonitor } from '../hooks/usePrinterMonitor';
import { Printer, Wifi, WifiOff, RefreshCw, CheckCircle, X } from 'lucide-react';

export default function PrinterStatusBanner() {
  const { status, reconnect, reconnectAll } = usePrinterMonitor();
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When all printers become connected, show success briefly then auto-hide
  useEffect(() => {
    if (status.allConnected && status.active) {
      setDismissed(false);
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

  // Some or all offline
  const allOffline = status.totalDisconnected === status.totalConfigured;
  const singleOffline = status.totalDisconnected === 1;

  const handleReconnectSingle = async (printerId: string) => {
    setReconnecting(printerId);
    await reconnect(printerId);
    setReconnecting(null);
  };

  const handleReconnectAll = async () => {
    setReconnecting('__all__');
    await reconnectAll();
    setReconnecting(null);
  };

  return (
    <div className={`printer-banner ${allOffline ? 'printer-banner--error' : 'printer-banner--warning'}`}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <WifiOff size={14} className="flex-shrink-0" />
        <Printer size={14} className="flex-shrink-0" />
        <span className="text-xs font-medium truncate">
          {singleOffline
            ? `${status.offlinePrinters[0].name} Offline`
            : `${status.totalDisconnected} Printer Tidak Terhubung`}
        </span>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {singleOffline ? (
          <button
            onClick={() => handleReconnectSingle(status.offlinePrinters[0].id)}
            disabled={reconnecting !== null}
            className="printer-banner__btn"
          >
            <RefreshCw size={12} className={reconnecting ? 'animate-spin' : ''} />
            <span>{reconnecting ? 'Menghubungkan...' : 'Reconnect'}</span>
          </button>
        ) : (
          <>
            {/* Show individual reconnect buttons if 2-3 printers offline */}
            {status.totalDisconnected <= 3 && status.offlinePrinters.map((p) => (
              <button
                key={p.id}
                onClick={() => handleReconnectSingle(p.id)}
                disabled={reconnecting !== null}
                className="printer-banner__btn"
                title={`Reconnect ${p.name}`}
              >
                <RefreshCw size={12} className={reconnecting === p.id ? 'animate-spin' : ''} />
                <span className="hidden sm:inline text-[10px]">{p.name.replace('Printer ', '')}</span>
              </button>
            ))}
            <button
              onClick={handleReconnectAll}
              disabled={reconnecting !== null}
              className="printer-banner__btn"
            >
              <RefreshCw size={12} className={reconnecting === '__all__' ? 'animate-spin' : ''} />
              <span>{reconnecting === '__all__' ? 'Menghubungkan...' : 'Reconnect Semua'}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
