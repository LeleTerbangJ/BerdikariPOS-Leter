import { useEffect, useCallback } from 'react';
import { usePrinterStatusStore } from '../store/printerStatusStore';
import {
  subscribePrinterEvents,
  reconnectBluetoothPrinter,
  isBluetoothConnected,
  getBluetoothStatus,
  getPrinterDeviceId,
} from '../utils/printer';
import { useSettingsStore } from '../store/settingsStore';

/**
 * TO DO 14.4 — Hook lintas-tab untuk status koneksi printer:
 * 1. Mendengarkan BroadcastChannel 'rempah-printer-events' (dipancarkan printer.ts)
 *    → status dari tab lain (mis. connect di Settings/POS terlihat di halaman Kitchen).
 * 2. Menyinkronkan status registry lokal (tab ini) sekali saat mount.
 * 3. `tryReconnectSilent(printerId)` — re-pair senyap tanpa picker.
 */
export function usePrinterCrossTab() {
  const applyEvent = usePrinterStatusStore((s) => s.applyEvent);
  const setConnected = usePrinterStatusStore((s) => s.setConnected);
  const { settings } = useSettingsStore();

  // Dengarkan peristiwa dari tab lain + sinkronkan status registry lokal
  useEffect(() => {
    const unsubscribe = subscribePrinterEvents((event) => applyEvent(event));

    // Sinkron status registry tab ini (printer yang tersambung di tab ini)
    const syncLocal = () => {
      const ids: string[] = [];
      if (settings.printerEnabled && settings.printerType === 'bluetooth') {
        ids.push('__cashier__');
      }
      for (const kp of settings.kitchenPrinters || []) {
        if (kp.enabled && kp.type === 'bluetooth') ids.push(kp.id);
      }
      for (const id of ids) {
        const st = getBluetoothStatus(id);
        setConnected(id, st.connected, st.deviceName);
      }
    };
    syncLocal();

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tryReconnectSilent = useCallback(
    async (printerId: string): Promise<boolean> => {
      // TO DO 14.6: satu sumber kebenaran device identity — helper getPrinterDeviceId
      const expected = getPrinterDeviceId(printerId, settings);
      if (!expected) return false;
      const result = await reconnectBluetoothPrinter(printerId, expected);
      if (result.success) {
        setConnected(printerId, true, result.deviceName);
      }
      return result.success;
    },
    [settings, setConnected]
  );

  const getStatus = useCallback(
    (printerId: string): { connected: boolean; deviceName?: string } => {
      const local = getBluetoothStatus(printerId);
      const stored = usePrinterStatusStore.getState().statuses[printerId];
      return {
        connected: local.connected || !!stored?.connected,
        deviceName: local.deviceName || stored?.deviceName,
      };
    },
    []
  );

  const isLocalConnected = useCallback((printerId: string): boolean => {
    return isBluetoothConnected(printerId);
  }, []);

  return { getStatus, tryReconnectSilent, isLocalConnected };
}
