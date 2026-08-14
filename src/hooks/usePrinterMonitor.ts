/**
 * usePrinterMonitor — Background service that monitors Bluetooth printer connections.
 * 
 * Polls the printer registry every 3 seconds to detect disconnections caused by
 * page refresh, Bluetooth range loss, or printer power-off.
 * 
 * Only activates when at least one printer is configured as 'bluetooth' type.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import {
  isBluetoothConnected,
  CASHIER_PRINTER_ID,
  connectBluetoothPrinter,
  reconnectBluetoothPrinter,
  getPrinterSessionState,
  getPrinterDeviceId,
} from '../utils/printer';

export interface PrinterMonitorStatus {
  /** Whether the monitor is active (at least one bluetooth printer configured) */
  active: boolean;
  /** Total number of Bluetooth printers configured */
  totalConfigured: number;
  /** Number of printers currently connected */
  totalConnected: number;
  /** Number of printers currently disconnected */
  totalDisconnected: number;
  /** List of disconnected printer details */
  offlinePrinters: Array<{
    id: string;
    name: string;
  }>;
  /** Whether all configured Bluetooth printers are connected */
  allConnected: boolean;
  /** Printer IDs yang tersambung di sesi sebelum refresh terakhir (untuk banner pasca-refresh) */
  previouslyConnected?: string[];
}

const POLL_INTERVAL_MS = 3000;

export function usePrinterMonitor(): {
  status: PrinterMonitorStatus;
  reconnect: (printerId: string) => Promise<boolean>;
  reconnectSilent: (printerId: string) => Promise<boolean>;
  reconnectAll: () => Promise<void>;
} {
  const { settings } = useSettingsStore();

  const computeStatus = useCallback((): PrinterMonitorStatus => {
    const printers: Array<{ id: string; name: string; connected: boolean }> = [];

    // Check cashier printer (only if configured as bluetooth)
    if (settings.printerEnabled && settings.printerType === 'bluetooth') {
      printers.push({
        id: CASHIER_PRINTER_ID,
        name: 'Printer Kasir',
        connected: isBluetoothConnected(CASHIER_PRINTER_ID),
      });
    }

    // Check kitchen printers (only bluetooth ones)
    if (settings.kitchenPrinters) {
      for (const kp of settings.kitchenPrinters) {
        if (kp.enabled && kp.type === 'bluetooth') {
          printers.push({
            id: kp.id,
            name: kp.name,
            connected: isBluetoothConnected(kp.id),
          });
        }
      }
    }

    const totalConfigured = printers.length;
    const totalConnected = printers.filter((p) => p.connected).length;
    const totalDisconnected = totalConfigured - totalConnected;
    const offlinePrinters = printers
      .filter((p) => !p.connected)
      .map((p) => ({ id: p.id, name: p.name }));

    return {
      active: totalConfigured > 0,
      totalConfigured,
      totalConnected,
      totalDisconnected,
      offlinePrinters,
      allConnected: totalConfigured > 0 && totalDisconnected === 0,
    };
  }, [settings]);

  const [status, setStatus] = useState<PrinterMonitorStatus>(computeStatus);

  // TO DO 14.1 P-2: daftar printer yang tersambung di sesi SEBELUM refresh
  const [previouslyConnected, setPreviouslyConnected] = useState<string[]>(() =>
    Object.keys(getPrinterSessionState())
  );

  // Poll at interval
  useEffect(() => {
    // Only poll if there are bluetooth printers configured
    const initial = computeStatus();
    setStatus(initial);

    if (!initial.active) return;

    const interval = setInterval(() => {
      setStatus(computeStatus());
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [computeStatus]);

  // Reconnect a single printer (user gesture — membuka picker bila perlu)
  const reconnect = useCallback(async (printerId: string): Promise<boolean> => {
    try {
      const result = await connectBluetoothPrinter(printerId);
      if (result.success) {
        // Update status immediately
        setStatus(computeStatus());
      }
      return result.success;
    } catch {
      return false;
    }
  }, [computeStatus]);

  // TO DO 14.1 P-1: re-pair senyap via getDevices() (tanpa picker) untuk satu printer
  // TO DO 14.6: satu sumber kebenaran device identity — helper getPrinterDeviceId (settings kanonik)
  const reconnectSilent = useCallback(async (printerId: string): Promise<boolean> => {
    const expected = getPrinterDeviceId(printerId, settings);
    if (!expected) return false;
    const result = await reconnectBluetoothPrinter(printerId, expected);
    if (result.success) setStatus(computeStatus());
    return result.success;
  }, [settings, computeStatus]);

  // TO DO 14.1 P-2: saat boot, coba re-pair senyap untuk printer yang tadinya tersambung
  // di sesi SEBELUM refresh (banner reconnect agresif hanya muncul bila re-pair senyap gagal).
  useEffect(() => {
    const session = getPrinterSessionState();
    const previously = Object.keys(session);
    if (previously.length === 0) return;

    const candidates: Array<{ id: string; deviceId?: string }> = [];
    for (const id of previously) {
      if (isBluetoothConnected(id)) continue;
      const deviceId = getPrinterDeviceId(id, settings);
      if (deviceId) candidates.push({ id, deviceId });
    }

    if (candidates.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const c of candidates) {
        if (cancelled) return;
        try {
          const r = await reconnectBluetoothPrinter(c.id, c.deviceId);
          if (r.success && !cancelled) setStatus(computeStatus());
        } catch {
          // lanjut printer berikutnya
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconnect all offline printers
  const reconnectAll = useCallback(async () => {
    const current = computeStatus();
    for (const printer of current.offlinePrinters) {
      try {
        await connectBluetoothPrinter(printer.id);
      } catch {
        // Continue with next printer
      }
    }
    setStatus(computeStatus());
  }, [computeStatus]);

  // TO DO 14.1 P-2: hapus tanda sesi setelah semua printer tersambung lagi (banner sukses)
  useEffect(() => {
    if (status.active && status.allConnected && previouslyConnected.length > 0) {
      setPreviouslyConnected([]);
      // sessionStorage dibersihkan di printer.ts via markPrinterSession — di sini cukup
      // menandai bahwa tidak perlu prompt reconnect lagi.
    }
  }, [status.active, status.allConnected, previouslyConnected.length]);

  return { status, reconnect, reconnectSilent, reconnectAll };
}
