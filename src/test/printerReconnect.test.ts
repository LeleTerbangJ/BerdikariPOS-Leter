import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// TO DO 14.1 (P-1/P-2) — test silent re-pair via navigator.bluetooth.getDevices()
// dan state sesi (sessionStorage) agar banner reconnect tahu printer yang tadinya
// tersambung sebelum refresh.
// ============================================================================

// Node/vitest tidak punya sessionStorage — injeksi fake sederhana.
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

function makeFakeDevice(id: string, name: string) {
  const device: any = {
    id,
    name,
    gatt: {
      connected: false,
      connect: vi.fn().mockImplementation(() => {
        device.gatt.connected = true;
        return Promise.resolve({
          getPrimaryService: vi.fn().mockResolvedValue({
            getCharacteristics: vi.fn().mockResolvedValue([
              { properties: { write: false, writeWithoutResponse: true } },
            ]),
          }),
        });
      }),
      disconnect: vi.fn().mockImplementation(() => {
        device.gatt.connected = false;
      }),
    },
    addEventListener: vi.fn(),
  };
  return device;
}

let bluetoothMock: {
  requestDevice?: () => Promise<any>;
  getDevices: () => Promise<any[]>;
};
let sessionStorageBackup: any;
let sessionStorageFake: FakeSessionStorage;

beforeEach(() => {
  sessionStorageFake = new FakeSessionStorage();
  sessionStorageBackup = (globalThis as any).sessionStorage;
  (globalThis as any).sessionStorage = sessionStorageFake;

  bluetoothMock = {
    getDevices: vi.fn().mockResolvedValue([]),
  };
  (navigator as any).bluetooth = bluetoothMock;
});

afterEach(() => {
  (globalThis as any).sessionStorage = sessionStorageBackup;
  delete (navigator as any).bluetooth;
});

async function loadPrinterModule() {
  vi.resetModules();
  return await import('../utils/printer');
}

describe('Printer reconnect sesi (TO DO 14.1 P-1/P-2)', () => {
  it('markPrinterSession → getPrinterSessionState mempertahankan printer lintas reload', async () => {
    const mod = await loadPrinterModule();
    mod.markPrinterSession('__cashier__', 'dev-123', 'Printer Kasir');
    mod.markPrinterSession('kp-1', 'dev-456', 'Printer Dapur');

    const state = mod.getPrinterSessionState();
    expect(state['__cashier__']).toMatchObject({ deviceId: 'dev-123', deviceName: 'Printer Kasir' });
    expect(state['kp-1']).toMatchObject({ deviceId: 'dev-456' });
    // Bertahan "reload": state dibaca ulang dari sessionStorage
    const mod2 = await loadPrinterModule();
    const state2 = mod2.getPrinterSessionState();
    expect(state2['__cashier__'].deviceId).toBe('dev-123');
  });

  it('clearPrinterSession menghapus printer dari state sesi (user memutus manual)', async () => {
    const mod = await loadPrinterModule();
    mod.markPrinterSession('__cashier__', 'dev-123', 'Printer Kasir');
    mod.clearPrinterSession('__cashier__');
    expect(mod.getPrinterSessionState()['__cashier__']).toBeUndefined();
  });

  it('reconnectBluetoothPrinter re-pair senyap via getDevices() tanpa picker', async () => {
    const device = makeFakeDevice('dev-123', 'Printer Kasir');
    (bluetoothMock.getDevices as any).mockResolvedValue([device]);

    const mod = await loadPrinterModule();
    const result = await mod.reconnectBluetoothPrinter(mod.CASHIER_PRINTER_ID, 'dev-123');

    expect(result.success).toBe(true);
    expect(result.deviceId).toBe('dev-123');
    // Terdaftar di registry → status connected
    expect(mod.isBluetoothConnected(mod.CASHIER_PRINTER_ID)).toBe(true);
    // device.gatt.connect dipanggil TANPA requestDevice (tidak ada picker)
    expect(bluetoothMock.requestDevice).toBeUndefined();
    expect(device.gatt.connect).toHaveBeenCalled();
    // State sesi tercatat
    expect(mod.getPrinterSessionState()[mod.CASHIER_PRINTER_ID].deviceId).toBe('dev-123');
  });

  it('reconnectBluetoothPrinter gagal bila deviceId tidak ada di getDevices()', async () => {
    const device = makeFakeDevice('dev-999', 'Lain');
    (bluetoothMock.getDevices as any).mockResolvedValue([device]);

    const mod = await loadPrinterModule();
    const result = await mod.reconnectBluetoothPrinter(mod.CASHIER_PRINTER_ID, 'dev-123');

    expect(result.success).toBe(false);
    expect(mod.isBluetoothConnected(mod.CASHIER_PRINTER_ID)).toBe(false);
  });

  it('reconnectBluetoothPrinter gagal bila navigator.bluetooth tidak mendukung getDevices', async () => {
    delete (navigator as any).bluetooth;
    (navigator as any).bluetooth = { requestDevice: () => Promise.resolve(null) };

    const mod = await loadPrinterModule();
    const result = await mod.reconnectBluetoothPrinter(mod.CASHIER_PRINTER_ID, 'dev-123');
    expect(result.success).toBe(false);
  });

  it('disconnectBluetoothPrinter membersihkan registry DAN state sesi', async () => {
    const device = makeFakeDevice('dev-123', 'Printer Kasir');
    (bluetoothMock.getDevices as any).mockResolvedValue([device]);

    const mod = await loadPrinterModule();
    await mod.reconnectBluetoothPrinter(mod.CASHIER_PRINTER_ID, 'dev-123');
    expect(mod.isBluetoothConnected(mod.CASHIER_PRINTER_ID)).toBe(true);

    await mod.disconnectBluetoothPrinter(mod.CASHIER_PRINTER_ID);
    expect(mod.isBluetoothConnected(mod.CASHIER_PRINTER_ID)).toBe(false);
    expect(mod.getPrinterSessionState()[mod.CASHIER_PRINTER_ID]).toBeUndefined();
  });
});
