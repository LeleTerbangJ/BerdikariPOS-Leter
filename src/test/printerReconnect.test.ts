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

// ======================================================================
// R-B2 — Klasifikasi penyebab putus: refresh (content) vs non-refresh
// (printer mati listrik / kehilangan jarak) via usia connectedAt, sehingga
// banner tidak menyesatkan dan non-refresh bisa di-dismiss.
// ======================================================================
describe('isPrinterSessionRecent (R-B2) — klasifikasi penyebab putus', () => {
  it('tanpa entri sesi → false (belum pernah tersambung di sesi ini)', async () => {
    const mod = await loadPrinterModule();
    expect(mod.isPrinterSessionRecent('kp-baru', 1_000_000)).toBe(false);
  });

  it('connectedAt baru (dalam jendela refresh default) → true → pesan "akibat refresh"', async () => {
    const mod = await loadPrinterModule();
    mod.markPrinterSession('kp-1', 'dev-1', 'Printer Dapur');
    const connectedAt = mod.getPrinterSessionState()['kp-1'].connectedAt;
    // 1 menit setelah connect — masih dalam 5 menit → refresh
    expect(mod.isPrinterSessionRecent('kp-1', connectedAt + 60_000)).toBe(true);
    // Tepat di ambang jendela → masih recent
    expect(mod.isPrinterSessionRecent('kp-1', connectedAt + mod.PRINTER_SESSION_REFRESH_WINDOW_MS)).toBe(true);
  });

  it('connectedAt lama (di luar jendela) → false → pesan netral "terputus"', async () => {
    const mod = await loadPrinterModule();
    mod.markPrinterSession('kp-1', 'dev-1', 'Printer Dapur');
    const connectedAt = mod.getPrinterSessionState()['kp-1'].connectedAt;
    // Printer connect jam 09:00, mati listrik 14:00 → sesi berumur 5 jam → BUKAN refresh
    expect(mod.isPrinterSessionRecent('kp-1', connectedAt + 5 * 60 * 60 * 1000)).toBe(false);
  });

  it('jendela kustom dihormati (parameter windowMs)', async () => {
    const mod = await loadPrinterModule();
    mod.markPrinterSession('kp-1', 'dev-1', 'Printer Dapur');
    const connectedAt = mod.getPrinterSessionState()['kp-1'].connectedAt;
    expect(mod.isPrinterSessionRecent('kp-1', connectedAt + 60_000, 30_000)).toBe(false);
    expect(mod.isPrinterSessionRecent('kp-1', connectedAt + 60_000, 120_000)).toBe(true);
  });

  it('clearPrinterSession (user memutus manual) → bukan lagi "recent"', async () => {
    const mod = await loadPrinterModule();
    mod.markPrinterSession('kp-1', 'dev-1', 'Printer Dapur');
    mod.clearPrinterSession('kp-1');
    expect(mod.isPrinterSessionRecent('kp-1', Date.now())).toBe(false);
  });

  it('campuran: printer sesi lama (non-refresh) + printer baru (refresh) diklasifikasikan terpisah', async () => {
    const mod = await loadPrinterModule();
    mod.markPrinterSession('kp-lama', 'dev-1', 'Printer Barista');
    const connectedAtLama = mod.getPrinterSessionState()['kp-lama'].connectedAt;
    mod.markPrinterSession('kp-baru', 'dev-2', 'Printer Dapur');
    const connectedAtBaru = mod.getPrinterSessionState()['kp-baru'].connectedAt;
    // Sesi lama (5 jam) → non-refresh; sesi baru (30 detik) → refresh
    expect(mod.isPrinterSessionRecent('kp-lama', connectedAtLama + 5 * 60 * 60 * 1000)).toBe(false);
    expect(mod.isPrinterSessionRecent('kp-baru', connectedAtBaru + 30_000)).toBe(true);
  });
});

// =====================================================================
// U-F3 — sanitizeForThermalPrint: strip emoji/simbol non-Latin
// =====================================================================
describe('sanitizeForThermalPrint (U-F3) — anti simbol aneh di struk', () => {
  it('teks ASCII murni tidak berubah', async () => {
    const mod = await loadPrinterModule();
    expect(mod.sanitizeForThermalPrint('Kasir: Budi')).toBe('Kasir: Budi');
    expect(mod.sanitizeForThermalPrint('Rp 10.000')).toBe('Rp 10.000');
  });

  it('emoji diganti dengan representasi ASCII', async () => {
    const mod = await loadPrinterModule();
    expect(mod.sanitizeForThermalPrint('Kopi ☕ Senja')).toBe('Kopi (kopi) Senja');
    expect(mod.sanitizeForThermalPrint('Burger 🍔')).toBe('Burger (burger)');
  });

  it('simbol unicode umum diganti', async () => {
    const mod = await loadPrinterModule();
    expect(mod.sanitizeForThermalPrint('Best ★')).toBe('Best *');
    expect(mod.sanitizeForThermalPrint('Done ✓')).toBe('Done v');
    expect(mod.sanitizeForThermalPrint('Arah →')).toBe('Arah ->');
  });

  it('karakter non-Latin-1 yang tidak punya replacement → ?', async () => {
    const mod = await loadPrinterModule();
    // CJK / huruf arab / dll → strip ke ? (spasi tetap dipertahankan)
    const result = mod.sanitizeForThermalPrint('안녕 مرحبا');
    // Hanya berisi ? dan spasi — tidak ada karakter CJK yang lolos
    expect(result).toMatch(/^[\?\s]+$/);
    expect(result).not.toMatch(/[\u0100-\uFFFF]/);
  });

  it('rentetan emoji multi-codepoint tidak menghasilkan ??? berlebihan', async () => {
    const mod = await loadPrinterModule();
    // Emoji dengan ZWJ → multiple codepoints → diganti lalu ? berlebihan di-clean
    const result = mod.sanitizeForThermalPrint('Hello 🛒🛒🛒 World');
    // Tidak ada ?? lebih dari 1 berturut-turut
    expect(result).not.toMatch(/\?{2,}/);
  });

  it('null/undefined → string kosong', async () => {
    const mod = await loadPrinterModule();
    expect(mod.sanitizeForThermalPrint(null)).toBe('');
    expect(mod.sanitizeForThermalPrint(undefined)).toBe('');
  });

  it('smart quotes diganti dengan ASCII quotes', async () => {
    const mod = await loadPrinterModule();
    expect(mod.sanitizeForThermalPrint('“test”')).toBe('"test"');
    expect(mod.sanitizeForThermalPrint("apos’")).toBe("apos'");
  });

  it('garis em/en dash diganti dengan ASCII dash', async () => {
    const mod = await loadPrinterModule();
    expect(mod.sanitizeForThermalPrint('A—B')).toBe('A-B');
    expect(mod.sanitizeForThermalPrint('C–D')).toBe('C-D');
  });

  it('campuran: nama menu dengan emoji + teks normal', async () => {
    const mod = await loadPrinterModule();
    const result = mod.sanitizeForThermalPrint('🍕 Pizza Margherita ★ Best Seller');
    expect(result).toBe('(pizza) Pizza Margherita * Best Seller');
    // Tidak ada karakter non-ASCII yang tersisa
    expect(result).not.toMatch(/[\u0100-\uFFFF]/);
  });
});
