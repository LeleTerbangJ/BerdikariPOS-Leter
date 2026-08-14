import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// TO DO 14.5 + 14.6 — test fallback browser print yang EKSPLISIT per printer
// (cashierFallbackBrowser / kp.fallbackBrowser) + satu sumber kebenaran device
// identity (getPrinterDeviceId/Name) + penggantian alert() dengan toast.
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

let sessionStorageFake: FakeSessionStorage;
let sessionStorageBackup: any;
let windowBackup: any;
let documentBackup: any;
let alertBackup: any;

beforeEach(() => {
  sessionStorageFake = new FakeSessionStorage();
  sessionStorageBackup = (globalThis as any).sessionStorage;
  (globalThis as any).sessionStorage = sessionStorageFake;

  // toastStore memakai window.setTimeout; printHtmlInIframe fallback memakai window.open
  windowBackup = (globalThis as any).window;
  (globalThis as any).window = { setTimeout: () => 0, open: () => null };

  alertBackup = (globalThis as any).alert;
  (globalThis as any).alert = vi.fn();

  documentBackup = (globalThis as any).document;
});

afterEach(() => {
  (globalThis as any).sessionStorage = sessionStorageBackup;
  (globalThis as any).window = windowBackup;
  (globalThis as any).document = documentBackup;
  (globalThis as any).alert = alertBackup;
  delete (navigator as any).bluetooth;
});

async function loadPrinterModule() {
  vi.resetModules();
  return await import('../utils/printer');
}

/**
 * Stub DOM minimal agar printHtmlInIframe (jalur browser print) bisa berjalan di Node
 * dan terobservasi: createElement('iframe') tercatat — dipakai sebagai bukti bahwa
 * fallback browser benar-benar dieksekusi (bukan diam-diam dilewati).
 */
function installFakeDom() {
  const createdIframes: any[] = [];
  const doc = {
    getElementById: vi.fn(() => null),
    createElement: vi.fn(() => {
      const el: any = { id: '', style: {}, contentWindow: undefined, contentDocument: undefined };
      createdIframes.push(el);
      return el;
    }),
    body: { appendChild: vi.fn() },
  };
  (globalThis as any).document = doc;
  return { doc, createdIframes };
}

function makeBaseSettings(overrides: Record<string, any> = {}) {
  return {
    managerPin: '1234',
    storeName: 'Test Store',
    categories: [],
    printerEnabled: true,
    printerType: 'bluetooth',
    printerWidth: '58mm',
    autoPrintOnCheckout: false,
    superAdminPin: '000000',
    demoMode: false,
    kitchenPrinters: [],
    ...overrides,
  };
}

function makeKitchenPrinter(overrides: Record<string, any> = {}) {
  return {
    id: 'kp-1',
    name: 'Printer Dapur Makanan',
    targetCategory: 'Makanan',
    enabled: true,
    type: 'bluetooth',
    width: '58mm',
    ...overrides,
  };
}

function makeReceiptData(items: any[] = []) {
  return {
    storeName: 'Test Store',
    queueNumber: 1,
    date: new Date().toISOString(),
    cashierName: 'Kasir',
    items,
    subtotal: 10000,
    discount: 0,
    total: 10000,
    paymentMethod: 'Cash',
  };
}

function makeFoodItem() {
  return {
    lineId: 'l1',
    menuId: 'm1',
    name: 'Nasi Goreng',
    basePrice: 10000,
    quantity: 1,
    temperature: 'Panas',
    sugar: 'Normal',
    addons: [],
    subtotal: 10000,
    kitchenTarget: 'Makanan',
  };
}

describe('14.5 — Fallback browser eksplisit per printer', () => {
  it('printTextRaw: fallback ON (default) + BT terputus → return true & cetak via browser', async () => {
    // getDevices() kosong → re-pair senyap gagal → fallback browser dipakai
    (navigator as any).bluetooth = { getDevices: vi.fn().mockResolvedValue([]) };
    const { doc, createdIframes } = installFakeDom();

    const mod = await loadPrinterModule();
    const settings = makeBaseSettings({ cashierFallbackBrowser: true });
    const ok = await mod.printTextRaw(['=== RINGKASAN ==='], settings);

    expect(ok).toBe(true);
    // Bukti jalur browser print dieksekusi: iframe thermal dibuat
    expect(doc.createElement).toHaveBeenCalledWith('iframe');
    expect(createdIframes.length).toBeGreaterThan(0);
  });

  it('printTextRaw: fallback OFF (cashierFallbackBrowser=false) + BT terputus → return false & TIDAK cetak browser', async () => {
    (navigator as any).bluetooth = { getDevices: vi.fn().mockResolvedValue([]) };
    const { doc } = installFakeDom();

    const mod = await loadPrinterModule();
    const settings = makeBaseSettings({ cashierFallbackBrowser: false });
    const ok = await mod.printTextRaw(['=== RINGKASAN ==='], settings);

    expect(ok).toBe(false);
    expect(doc.createElement).not.toHaveBeenCalled();
  });

  it('printReceipt: printer dapur BT fallback OFF + terputus → status error (bukan sukses diam-diam)', async () => {
    (navigator as any).bluetooth = { getDevices: vi.fn().mockResolvedValue([]) };
    const { doc } = installFakeDom();

    const mod = await loadPrinterModule();
    const kp = makeKitchenPrinter({ fallbackBrowser: false });
    const settings = makeBaseSettings({
      printerEnabled: false, // lewati struk kasir — fokus tiket dapur
      kitchenPrinters: [kp],
    });
    const data = makeReceiptData([makeFoodItem()]);

    const results = await mod.printReceipt(data, settings, 'kitchen');

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('fallback browser nonaktif');
    expect(doc.createElement).not.toHaveBeenCalled();
  });

  it('printReceipt: printer dapur BT fallback ON → status success & tiket keluar via browser', async () => {
    (navigator as any).bluetooth = { getDevices: vi.fn().mockResolvedValue([]) };
    const { doc } = installFakeDom();

    const mod = await loadPrinterModule();
    const kp = makeKitchenPrinter({ fallbackBrowser: true });
    const settings = makeBaseSettings({
      printerEnabled: false,
      kitchenPrinters: [kp],
    });
    const data = makeReceiptData([makeFoodItem()]);

    const results = await mod.printReceipt(data, settings, 'kitchen');

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
    expect(doc.createElement).toHaveBeenCalledWith('iframe');
  });
});

describe('14.6 — Satu sumber kebenaran device identity', () => {
  it('getPrinterDeviceId: settings (kanonik) menang atas session; session jadi fallback', async () => {
    const mod = await loadPrinterModule();
    mod.markPrinterSession(mod.CASHIER_PRINTER_ID, 'dev-session', 'Session Printer');

    const settings = makeBaseSettings({ cashierBluetoothDeviceId: 'dev-settings', cashierBluetoothDeviceName: 'Settings Printer' });

    // Settings lebih prioritas (persisten = kanonik)
    expect(mod.getPrinterDeviceId(mod.CASHIER_PRINTER_ID, settings)).toBe('dev-settings');
    expect(mod.getPrinterDeviceName(mod.CASHIER_PRINTER_ID, settings)).toBe('Settings Printer');

    // Tanpa settings → fallback ke state sesi
    expect(mod.getPrinterDeviceId(mod.CASHIER_PRINTER_ID)).toBe('dev-session');
    expect(mod.getPrinterDeviceName(mod.CASHIER_PRINTER_ID)).toBe('Session Printer');
  });

  it('getPrinterDeviceId: printer dapur membaca dari kitchenPrinters settings', async () => {
    const mod = await loadPrinterModule();
    const kp = makeKitchenPrinter({ bluetoothDeviceId: 'dev-kp', bluetoothDeviceName: 'KP Name' });
    const settings = makeBaseSettings({ kitchenPrinters: [kp] });

    expect(mod.getPrinterDeviceId(kp.id, settings)).toBe('dev-kp');
    expect(mod.getPrinterDeviceName(kp.id, settings)).toBe('KP Name');
    // Bukan printer kasir
    expect(mod.getPrinterDeviceId(mod.CASHIER_PRINTER_ID, settings)).toBeUndefined();
  });

  it('connectBluetoothPrinter tanpa dukungan Web Bluetooth → toast, TIDAK alert()', async () => {
    // navigator.bluetooth undefined → cabang pertama connectBluetoothPrinter
    delete (navigator as any).bluetooth;

    const mod = await loadPrinterModule();
    const alertSpy = (globalThis as any).alert;
    const result = await mod.connectBluetoothPrinter(mod.CASHIER_PRINTER_ID);

    expect(result.success).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
