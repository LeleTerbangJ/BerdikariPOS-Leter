import { create } from 'zustand';
import type { PrinterEvent } from '../utils/printer';

/**
 * TO DO 14.4 — Status koneksi printer lintas-tab (UI hint).
 *
 * Registry Bluetooth hidup in-memory per tab; store ini membagikan sinyal
 * connect/disconnect antar tab via BroadcastChannel (dipancarkan di printer.ts)
 * agar halaman seperti Kitchen/Dapur tahu printer mana yang tersambung,
 * walau koneksinya dibuat di tab lain (Settings/POS).
 *
 * Store ini TIDAK dipersist (transient) — hanya sinyal UI sesi.
 */

interface PrinterStatusInfo {
  connected: boolean;
  deviceName?: string;
}

interface PrinterStatusState {
  statuses: Record<string, PrinterStatusInfo>;
  applyEvent: (event: PrinterEvent) => void;
  setConnected: (printerId: string, connected: boolean, deviceName?: string) => void;
  reset: () => void;
}

export const usePrinterStatusStore = create<PrinterStatusState>()((set) => ({
  statuses: {},

  applyEvent: (event) => {
    set((s) => {
      if (event.type === 'connected') {
        return {
          statuses: {
            ...s.statuses,
            [event.printerId]: { connected: true, deviceName: event.deviceName },
          },
        };
      }
      // disconnected
      return {
        statuses: {
          ...s.statuses,
          [event.printerId]: { connected: false },
        },
      };
    });
  },

  setConnected: (printerId, connected, deviceName) => {
    set((s) => ({
      statuses: {
        ...s.statuses,
        [printerId]: { connected, deviceName },
      },
    }));
  },

  reset: () => set({ statuses: {} }),
}));
