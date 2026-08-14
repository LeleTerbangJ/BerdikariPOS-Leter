import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// TO DO 14.4 — test status koneksi printer lintas-tab:
// BroadcastChannel 'rempah-printer-events' + printerStatusStore.
// ============================================================================

class FakeSessionStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

// Fake BroadcastChannel sederhana: instance saling mengirim ke handler sendiri.
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  name: string;
  private handler: ((e: MessageEvent) => void) | null = null;
  closed = false;
  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }
  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    if (type === 'message') this.handler = handler;
  }
  removeEventListener(type: string, handler: (e: MessageEvent) => void) {
    if (this.handler === handler) this.handler = null;
  }
  postMessage(data: unknown) {
    if (this.closed) return;
    // Simulasi BroadcastChannel: kirim ke SEMUA instance dengan nama yang sama
    for (const inst of FakeBroadcastChannel.instances) {
      if (inst.name === this.name && inst !== this && !inst.closed) {
        inst.handler?.({ data } as MessageEvent);
      }
    }
  }
  close() {
    this.closed = true;
  }
}

let sessionStorageFake: FakeSessionStorage;
let sessionStorageBackup: any;
let bcBackup: any;

beforeEach(() => {
  sessionStorageFake = new FakeSessionStorage();
  sessionStorageBackup = (globalThis as any).sessionStorage;
  (globalThis as any).sessionStorage = sessionStorageFake;
  bcBackup = (globalThis as any).BroadcastChannel;
  (globalThis as any).BroadcastChannel = FakeBroadcastChannel as any;
});

afterEach(() => {
  (globalThis as any).sessionStorage = sessionStorageBackup;
  (globalThis as any).BroadcastChannel = bcBackup;
  FakeBroadcastChannel.instances = [];
});

describe('Status printer lintas-tab (TO DO 14.4)', () => {
  it('applyEvent connected/disconnected memperbarui store', async () => {
    const { usePrinterStatusStore } = await import('../store/printerStatusStore');
    usePrinterStatusStore.getState().reset();
    const store = usePrinterStatusStore.getState();
    store.applyEvent({ type: 'connected', printerId: 'kp-food', deviceName: 'Printer Dapur' });
    expect(usePrinterStatusStore.getState().statuses['kp-food']).toMatchObject({
      connected: true,
      deviceName: 'Printer Dapur',
    });
    store.applyEvent({ type: 'disconnected', printerId: 'kp-food' });
    expect(usePrinterStatusStore.getState().statuses['kp-food'].connected).toBe(false);
  });

  it('subscribePrinterEvents mengirim peristiwa dari printer.ts ke store', async () => {
    vi.resetModules();
    const mod = await import('../utils/printer');
    const { usePrinterStatusStore } = await import('../store/printerStatusStore');
    usePrinterStatusStore.getState().reset();

    // Pasang listener (simulasi tab lain / halaman Kitchen): terima event + forward ke store
    const received: any[] = [];
    const unsub = mod.subscribePrinterEvents((e) => {
      received.push(e);
      usePrinterStatusStore.getState().applyEvent(e);
    });

    // Buat instance channel terpisah (simulasi tab lain) dan kirim event — subscriber
    // (instance dari subscribePrinterEvents) harus menerimanya (broadcast lintas-tab).
    const sender = new FakeBroadcastChannel('rempah-printer-events');
    sender.postMessage({ type: 'connected', printerId: 'kp-drink' });
    await new Promise((r) => setTimeout(r, 10));
    sender.close();

    expect(received.some((e) => e.type === 'connected' && e.printerId === 'kp-drink')).toBe(true);
    expect(usePrinterStatusStore.getState().statuses['kp-drink']?.connected).toBe(true);
    unsub();
  });

  it('setConnected memperbarui status per printer', async () => {
    const { usePrinterStatusStore } = await import('../store/printerStatusStore');
    usePrinterStatusStore.getState().reset();
    usePrinterStatusStore.getState().setConnected('__cashier__', true, 'Printer Kasir');
    expect(usePrinterStatusStore.getState().statuses['__cashier__']).toMatchObject({
      connected: true,
      deviceName: 'Printer Kasir',
    });
  });
});
