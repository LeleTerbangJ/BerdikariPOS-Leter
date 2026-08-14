import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// TO DO 15.3 — opsi "cetak tanpa struk" per-transaksi: engine memanggil
// printReceipt dengan target 'kitchen' (skipReceiptPrint) vs 'all' (normal).
// Test ini membuktikan perilaku target: struk kasir dilewati saat 'kitchen',
// sedangkan tiket dapur TETAP dicetak.
// ============================================================================

let windowBackup: any;
let documentBackup: any;

beforeEach(() => {
  windowBackup = (globalThis as any).window;
  // Struk kasir browser memakai window.open + document.write; tiket dapur memakai iframe.
  (globalThis as any).window = {
    setTimeout: () => 0,
    open: vi.fn(() => ({ document: { write: vi.fn(), close: vi.fn() } })),
  };
  documentBackup = (globalThis as any).document;
});

afterEach(() => {
  (globalThis as any).window = windowBackup;
  (globalThis as any).document = documentBackup;
  delete (navigator as any).bluetooth;
});

async function loadPrinterModule() {
  vi.resetModules();
  return await import('../utils/printer');
}

/**
 * Stub DOM minimal agar jalur browser print terobservasi:
 * createElement('iframe') dicatat sebagai bukti print dieksekusi.
 */
function installFakeDom() {
  const createdIframes: any[] = [];
  const doc = {
    getElementById: vi.fn(() => null),
    createElement: vi.fn(() => {
      // printHtmlInIframe menulis ke iframe.contentWindow.document — stub dokumen agar
      // jalur iframe dipakai (bukan fallback window.open).
      const iframeDoc = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
      const el: any = {
        id: '',
        style: {},
        contentWindow: { document: iframeDoc, focus: vi.fn(), print: vi.fn() },
        contentDocument: iframeDoc,
      };
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
    printerType: 'browser',
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
    type: 'browser',
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

describe('15.3 — target print all vs kitchen (skipReceiptPrint)', () => {
  it('target "all" (normal) → struk kasir browser dicetak (window.print terbuka)', async () => {
    const { doc } = installFakeDom();
    const openSpy = (globalThis as any).window.open;
    const mod = await loadPrinterModule();
    const settings = makeBaseSettings(); // printer kasir browser, tanpa printer dapur

    const results = await mod.printReceipt(makeReceiptData([makeFoodItem()]), settings, 'all');

    expect(results.some((r: any) => r.printer === 'Printer Kasir' && r.status === 'success')).toBe(true);
    // Bukti struk kasir dicetak: window.open dipanggil (jalur browser print)
    expect(openSpy).toHaveBeenCalled();
  });

  it('target "kitchen" (skipReceiptPrint) tanpa printer dapur → struk kasir TIDAK dicetak (0 iframe)', async () => {
    const { doc } = installFakeDom();
    const mod = await loadPrinterModule();
    const settings = makeBaseSettings(); // printer kasir browser, tanpa printer dapur

    const results = await mod.printReceipt(makeReceiptData([makeFoodItem()]), settings, 'kitchen');

    expect(results).toHaveLength(0); // tidak ada struk kasir & tidak ada tiket dapur
    expect(doc.createElement).not.toHaveBeenCalled();
  });

  it('target "kitchen" (skipReceiptPrint) dengan printer dapur browser → tiket dapur TETAP keluar', async () => {
    const { doc, createdIframes } = installFakeDom();
    const mod = await loadPrinterModule();
    const kp = makeKitchenPrinter({ targetCategory: 'Makanan' });
    const settings = makeBaseSettings({ kitchenPrinters: [kp] });

    const results = await mod.printReceipt(makeReceiptData([makeFoodItem()]), settings, 'kitchen');

    expect(results).toHaveLength(1);
    expect(results[0].printer).toBe('Printer Dapur Makanan');
    expect(results[0].status).toBe('success');
    expect(doc.createElement).toHaveBeenCalledWith('iframe');
    expect(createdIframes.length).toBeGreaterThan(0);
  });

  it('printSplitReceipt: skipCashierPrint=true, skipKitchenPrint=false → struk kasir dilewati, tiket dapur TETAP dicetak', async () => {
    const { doc, createdIframes } = installFakeDom();
    const openSpy = (globalThis as any).window.open;
    const mod = await loadPrinterModule();
    const kp = makeKitchenPrinter({ targetCategory: 'Makanan' });
    const settings = makeBaseSettings({ kitchenPrinters: [kp] });
    const subTx = {
      id: 'sub-1',
      queueNumber: 5,
      date: new Date().toISOString(),
      cashierName: 'Kasir',
      items: [makeFoodItem()],
      subtotal: 10000,
      discount: 0,
      tax: 0,
      totalAmount: 10000,
      paymentMethod: 'Cash',
      orderType: 'Dine In',
      splitIndex: 1,
      totalSplitCount: 2,
      txStatus: 'Selesai',
    } as any;

    const results = await mod.printSplitReceipt(subTx, null, settings, 'all', [makeFoodItem()], true, false);

    // Struk kasir dilewati (window.open tidak dipanggil), tiket dapur TETAP keluar (iframe dibuat)
    expect(openSpy).not.toHaveBeenCalled();
    expect(doc.createElement).toHaveBeenCalledWith('iframe');
    expect(createdIframes.length).toBeGreaterThan(0);
    expect(results.some((r: any) => r.printer === 'Printer Dapur Makanan' && r.status === 'success')).toBe(true);
    expect(results.some((r: any) => r.printer === 'Printer Kasir')).toBe(false);
  });

  it('printSplitReceipt: skipCashierPrint=true + skipKitchenPrint=true → TIDAK mencetak apa pun (anti tiket dobel)', async () => {
    const { doc, createdIframes } = installFakeDom();
    const openSpy = (globalThis as any).window.open;
    const mod = await loadPrinterModule();
    const kp = makeKitchenPrinter({ targetCategory: 'Makanan' });
    const settings = makeBaseSettings({ kitchenPrinters: [kp] });
    const subTx = {
      id: 'sub-1',
      queueNumber: 5,
      date: new Date().toISOString(),
      cashierName: 'Kasir',
      items: [makeFoodItem()],
      subtotal: 10000,
      discount: 0,
      tax: 0,
      totalAmount: 10000,
      paymentMethod: 'Cash',
      orderType: 'Dine In',
      splitIndex: 1,
      totalSplitCount: 2,
      txStatus: 'Selesai',
    } as any;

    const results = await mod.printSplitReceipt(subTx, null, settings, 'all', [makeFoodItem()], true, true);

    // Tidak ada cetakan sama sekali: struk kasir TIDAK (window.open tidak dipanggil) &
    // tiket dapur TIDAK (iframe tidak dibuat)
    expect(results).toHaveLength(0);
    expect(openSpy).not.toHaveBeenCalled();
    expect(doc.createElement).not.toHaveBeenCalledWith('iframe');
    expect(createdIframes.length).toBe(0);
  });

  it('printSplitReceipt: tanpa skip (default) → struk kasir + tiket dapur keduanya dicetak', async () => {
    const { doc, createdIframes } = installFakeDom();
    const openSpy = (globalThis as any).window.open;
    const mod = await loadPrinterModule();
    const kp = makeKitchenPrinter({ targetCategory: 'Makanan' });
    const settings = makeBaseSettings({ kitchenPrinters: [kp] });
    const subTx = {
      id: 'sub-1',
      queueNumber: 5,
      date: new Date().toISOString(),
      cashierName: 'Kasir',
      items: [makeFoodItem()],
      subtotal: 10000,
      discount: 0,
      tax: 0,
      totalAmount: 10000,
      paymentMethod: 'Cash',
      orderType: 'Dine In',
      splitIndex: 1,
      totalSplitCount: 2,
      txStatus: 'Selesai',
    } as any;

    const results = await mod.printSplitReceipt(subTx, null, settings, 'all', [makeFoodItem()]);

    expect(openSpy).toHaveBeenCalled(); // struk kasir dicetak
    expect(doc.createElement).toHaveBeenCalledWith('iframe'); // tiket dapur dicetak
    expect(createdIframes.length).toBeGreaterThan(0);
    expect(results.some((r: any) => r.printer === 'Printer Kasir' && r.status === 'success')).toBe(true);
    expect(results.some((r: any) => r.printer === 'Printer Dapur Makanan' && r.status === 'success')).toBe(true);
  });

  it('target "all" dengan printer dapur browser → struk kasir (window.open) + tiket dapur (iframe) keduanya dicetak', async () => {
    const { doc, createdIframes } = installFakeDom();
    const openSpy = (globalThis as any).window.open;
    const mod = await loadPrinterModule();
    const kp = makeKitchenPrinter({ targetCategory: 'Makanan' });
    const settings = makeBaseSettings({ kitchenPrinters: [kp] });

    const results = await mod.printReceipt(makeReceiptData([makeFoodItem()]), settings, 'all');

    expect(results.some((r: any) => r.printer === 'Printer Kasir' && r.status === 'success')).toBe(true);
    expect(results.some((r: any) => r.printer === 'Printer Dapur Makanan' && r.status === 'success')).toBe(true);
    expect(openSpy).toHaveBeenCalled(); // struk kasir
    expect(doc.createElement).toHaveBeenCalledWith('iframe'); // tiket dapur
    expect(createdIframes.length).toBeGreaterThan(0);
  });
});
