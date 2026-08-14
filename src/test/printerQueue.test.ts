import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// TO DO 14.2 + 14.3 — test print queue FIFO per printer + retry 1×.
// Queue & registry adalah module-level → tiap test di-load ulang via resetModules.
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

beforeEach(() => {
  sessionStorageFake = new FakeSessionStorage();
  sessionStorageBackup = (globalThis as any).sessionStorage;
  (globalThis as any).sessionStorage = sessionStorageFake;
});

afterEach(() => {
  (globalThis as any).sessionStorage = sessionStorageBackup;
  delete (navigator as any).bluetooth;
});

function makeFakeDevice(id: string, name: string, writes: any[] = []) {
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
              {
                properties: { write: false, writeWithoutResponse: true },
                writeValueWithoutResponse: vi.fn().mockImplementation(async (chunk: Uint8Array) => {
                  if (writes.onWrite) await writes.onWrite(chunk);
                }),
                writeValue: vi.fn(),
              },
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

async function loadPrinterModule() {
  vi.resetModules();
  return await import('../utils/printer');
}

describe('Print queue per printer (TO DO 14.3)', () => {
  it('dua job ke printer yang sama diproses SEQUENTIAL (FIFO, tidak tumpang tindih)', async () => {
    const writes: number[] = [];
    let active = 0;
    let maxActive = 0;
    const device = makeFakeDevice('dev-q', 'Printer Q', {
      onWrite: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        writes.push(active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
      },
    });
    (navigator as any).bluetooth = { getDevices: vi.fn().mockResolvedValue([device]) };

    const mod = await loadPrinterModule();
    await mod.reconnectBluetoothPrinter('__cashier__', 'dev-q');

    // Dua job test print (data berbeda karena lebar berbeda)
    const p1 = mod.testPrintBluetooth('__cashier__', 'Printer Q', 'Test 1', '58mm');
    const p2 = mod.testPrintBluetooth('__cashier__', 'Printer Q', 'Test 2', '80mm');
    await Promise.all([p1, p2]);

    // Tidak pernah ada 2 tulis bersamaan → serial per printer
    expect(maxActive).toBe(1);
    expect(writes.length).toBeGreaterThan(1);
  });

  it('gagal sekali → retry 1× → sukses (job tidak hilang)', async () => {
    let failOnce = true;
    let writeCalls = 0;
    const device = makeFakeDevice('dev-r', 'Printer R', {
      onWrite: async () => {
        writeCalls += 1;
        if (failOnce) {
          failOnce = false;
          throw new Error('GATT busy (transient)');
        }
      },
    });
    (navigator as any).bluetooth = { getDevices: vi.fn().mockResolvedValue([device]) };

    const mod = await loadPrinterModule();
    await mod.reconnectBluetoothPrinter('__cashier__', 'dev-r');

    // Fake writeValueWithoutResponse melempar saat pertama kali — retry harus sukses
    const conn: any = mod as any;
    // Simulasi: akses karakteristik lewat print (testPrintBluetooth) — write pertama gagal,
    // retry berhasil. Karena fake men-set failOnce=false, job kedua (setelah retry) sukses.
    await expect(mod.testPrintBluetooth('__cashier__', 'Printer R', 'Retry', '58mm')).resolves.toBeUndefined();
    expect(writeCalls).toBeGreaterThan(1);
    void conn;
  });

  it('gagal dua kali → job di-drop dengan warning (tidak menggantung)', async () => {
    const device = makeFakeDevice('dev-f', 'Printer F', {
      onWrite: async () => {
        throw new Error('GATT selalu gagal');
      },
    });
    (navigator as any).bluetooth = { getDevices: vi.fn().mockResolvedValue([device]) };

    const mod = await loadPrinterModule();
    await mod.reconnectBluetoothPrinter('__cashier__', 'dev-f');

    // Jangan menggantung: print tetap selesai walau gagal permanen
    await expect(mod.testPrintBluetooth('__cashier__', 'Printer F', 'Gagal', '58mm')).resolves.toBeUndefined();
  });
});
