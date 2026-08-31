// ============================================================
// v4.10 P.4 — ITEM NON-MENU / CUSTOM (qty & harga bebas di POS)
// Test: identifikasi item, merge keranjang, HPP/deduksi 0, guard
// tiket dapur, bucket laporan, exclude promo berbasis menu.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCartStore } from '../store/cartStore';
import { createSnapshotForCartItems, calculateItemDeductions } from '../utils/hpp';
import { InventoryEngine } from '../lib/inventoryEngine';
import {
  isCustomItem,
  customItemReportKey,
  customItemReportName,
  CUSTOM_ITEM_BUCKET_NAME,
  CUSTOM_ITEM_BUCKET_KEY,
  CUSTOM_MENU_ID_PREFIX,
} from '../utils/customItem';
import {
  calculatePromoDiscount,
  calculateBogoDiscount,
  isPromoApplicable,
  eligibleItemQty,
} from '../utils/promoDiscount';
import type { CartItem, Menu, InventoryItem, Promo, AppSettings } from '../types';

function makeCustomItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    lineId: `custom-${Math.random().toString(36).slice(2, 8)}`,
    menuId: `${CUSTOM_MENU_ID_PREFIX}${Math.random().toString(36).slice(2, 12)}`,
    name: 'Sambal',
    basePrice: 10000,
    quantity: 1,
    temperature: 'Hangat',
    sugar: 'None',
    addons: [],
    subtotal: 10000,
    isCustom: true,
    ...overrides,
  };
}

function makeMenuItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    lineId: 'line-1',
    menuId: 'm1',
    name: 'Lele Original',
    basePrice: 10000,
    quantity: 1,
    temperature: 'Hangat',
    sugar: 'None',
    addons: [],
    subtotal: 10000,
    ...overrides,
  };
}

const menus: Menu[] = [
  { id: 'm1', name: 'Lele Original', category: 'Makanan', price: 10000, ingredients: {}, availableAddons: [] },
  { id: 'm2', name: 'Es Kopi', category: 'Minuman', price: 15000, ingredients: {}, availableAddons: [] },
];

// ============================================================
// Identifikasi item non-menu
// ============================================================
describe('customItem — identifikasi & bucket laporan (P.4)', () => {
  it('isCustomItem: flag eksplisit true → custom', () => {
    expect(isCustomItem(makeCustomItem())).toBe(true);
  });

  it('isCustomItem: fallback menuId berawalan custom: (transaksi legacy lintas device)', () => {
    expect(isCustomItem({ menuId: 'custom:abc-123', isCustom: false })).toBe(true);
    expect(isCustomItem({ menuId: 'custom:abc-123' })).toBe(true);
  });

  it('isCustomItem: item menu biasa / null → false', () => {
    expect(isCustomItem(makeMenuItem())).toBe(false);
    expect(isCustomItem(null)).toBe(false);
    expect(isCustomItem(undefined)).toBe(false);
  });

  it('bucket laporan: semua item custom → SATU bucket "Item Non-Menu"', () => {
    const a = makeCustomItem({ name: 'Sambal A', menuId: 'custom:x1' });
    const b = makeCustomItem({ name: 'Sambal B', menuId: 'custom:x2' });
    // R-A5: key agregasi sintetis (bukan nama bucket) — anti-bentrok nama menu
    expect(customItemReportKey(a)).toBe(CUSTOM_ITEM_BUCKET_KEY);
    expect(customItemReportKey(b)).toBe(CUSTOM_ITEM_BUCKET_KEY);
    // Nama tampilan tetap bucket
    expect(customItemReportName(a)).toBe(CUSTOM_ITEM_BUCKET_NAME);
    // item menu tetap by menuId & nama asli
    expect(customItemReportKey(makeMenuItem())).toBe('m1');
    expect(customItemReportName(makeMenuItem())).toBe('Lele Original');
  });

  it('R-A5: menu nyata bernama "Item Non-Menu" TIDAK bentrok dengan bucket custom (key sintetis)', () => {
    const menuNamed = { ...makeMenuItem({ menuId: 'm9', name: CUSTOM_ITEM_BUCKET_NAME }) };
    const custom = makeCustomItem({ name: 'Sambal' });
    expect(customItemReportKey(menuNamed)).toBe('m9'); // key by menuId — bukan nama
    expect(customItemReportKey(custom)).toBe(CUSTOM_ITEM_BUCKET_KEY);
    expect(customItemReportKey(menuNamed)).not.toBe(customItemReportKey(custom));
  });
});

// ============================================================
// Merge keranjang — item custom by (isCustom, nama, harga)
// ============================================================
describe('cartStore.addItem — merge item custom (P.4)', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart();
  });

  it('nama + harga sama → di-merge qty (2 + 1 = 3) dengan subtotal benar', () => {
    const cart = useCartStore.getState();
    cart.addItem(makeCustomItem({ quantity: 2, subtotal: 20000 }));
    cart.addItem(makeCustomItem({ name: 'Sambal', basePrice: 10000, quantity: 1, subtotal: 10000 }));

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
    expect(items[0].subtotal).toBe(30000);
  });

  it('nama berbeda → baris terpisah', () => {
    const cart = useCartStore.getState();
    cart.addItem(makeCustomItem({ name: 'Sambal' }));
    cart.addItem(makeCustomItem({ name: 'Kerupuk' }));

    expect(useCartStore.getState().items).toHaveLength(2);
  });

  it('harga berbeda → baris terpisah (walaupun nama sama)', () => {
    const cart = useCartStore.getState();
    cart.addItem(makeCustomItem({ basePrice: 10000, subtotal: 10000 }));
    cart.addItem(makeCustomItem({ basePrice: 15000, subtotal: 15000 }));

    expect(useCartStore.getState().items).toHaveLength(2);
  });

  it('item custom TIDAK pernah merge dengan item menu yang kebetulan sama nama', () => {
    const cart = useCartStore.getState();
    cart.addItem(makeCustomItem({ name: 'Sambal', menuId: 'custom:aaa' }));
    cart.addItem(makeMenuItem({ name: 'Sambal', menuId: 'm1', isCustom: false }));

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(2);
  });
});

// ============================================================
// HPP & deduksi stok — item custom tidak menyentuh stok
// ============================================================
describe('HPP & stok untuk item custom (P.2/P.4)', () => {
  it('createSnapshotForCartItems: custom tanpa customHpp → recipeSnapshot [] & HPP 0', () => {
    const { itemsWithSnapshot, totalHpp } = createSnapshotForCartItems(
      [makeCustomItem({ quantity: 2 })],
      menus,
      []
    );
    expect(totalHpp).toBe(0);
    expect(itemsWithSnapshot[0].recipeSnapshot).toEqual([]);
    expect(itemsWithSnapshot[0].hpp).toBe(0);
    expect(itemsWithSnapshot[0].cogs).toBe(0);
  });

  it('custom dengan customHpp → HPP = modal * qty (pseudo manual, TANPA deduksi stok)', () => {
    const item = makeCustomItem({ quantity: 2, customHpp: 5000 });
    const { itemsWithSnapshot, totalHpp } = createSnapshotForCartItems([item], menus, []);
    expect(totalHpp).toBe(10000);
    expect(itemsWithSnapshot[0].recipeSnapshot?.[0]?.inventoryId).toMatch(/^manual_custom_/);
    expect(itemsWithSnapshot[0].cogs).toBe(10000);
    // deduksi stok TETAP kosong — pseudo ingredient manual_ dilewati
    expect(calculateItemDeductions(itemsWithSnapshot, menus)).toEqual({});
  });

  it('calculateItemDeductions: custom tanpa snapshot → {} (tidak bocor stok)', () => {
    expect(calculateItemDeductions([makeCustomItem({ quantity: 3 })], menus)).toEqual({});
  });

  it('InventoryEngine.validateStockAvailability: custom → valid tanpa warning (tidak ada referensi bahan)', () => {
    const result = InventoryEngine.validateStockAvailability(
      [makeCustomItem({ quantity: 5 })],
      menus,
      []
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

// ============================================================
// Promo — custom dikecualikan dari promo berbasis menu, diskon transaksi tetap jalan
// ============================================================
function makePromo(over: Partial<Promo>): Promo {
  return {
    id: 'p1',
    name: 'Promo',
    type: 'percentage',
    value: 10,
    scope: 'all',
    isActive: true,
    usageCount: 0,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-12-31T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('promoDiscount — exclude item custom (P.4)', () => {
  it('BOGO: item custom TIDAK ikut pool unit gratis (beli 2 gratis 1)', () => {
    const promo = makePromo({ type: 'bogo', scope: 'all', bogoBuyQty: 2, bogoFreeQty: 1 });
    // custom 10rb + menu 10rb — bila custom dihitung: 2 unit → 1 set → gratis 10rb.
    // Dengan exclude: hanya 1 unit eligible → 0 set → diskon 0.
    const ctx = { cartItems: [makeCustomItem(), makeMenuItem()], menus };
    expect(calculateBogoDiscount(promo, ctx)).toBe(0);

    // Kontrol: dua item MENU → BOGO normal jalan
    const ctxMenu = { cartItems: [makeMenuItem(), makeMenuItem({ lineId: 'l2', quantity: 1 })], menus };
    expect(calculateBogoDiscount(promo, ctxMenu)).toBe(10000);
  });

  it('scope menu minQty: qty item custom tidak dihitung menuju gate', () => {
    const promo = makePromo({ scope: 'menu', scopeTarget: 'm1', minQty: 2 });
    // Keranjang hanya berisi item custom (menuId sintetis) → eligible 0 < 2 → tidak berlaku
    expect(isPromoApplicable(promo, 20000, { cartItems: [makeCustomItem({ quantity: 5 })], menus })).toBe(false);
    // 1 menu m1 + 1 custom → eligible 1 < 2 → tetap tidak berlaku
    expect(
      isPromoApplicable(promo, 20000, { cartItems: [makeMenuItem(), makeCustomItem()], menus })
    ).toBe(false);
    // 2 menu m1 → berlaku
    expect(
      isPromoApplicable(promo, 20000, { cartItems: [makeMenuItem(), makeMenuItem({ lineId: 'l2' })], menus })
    ).toBe(true);
  });

  it('scope category: custom saja tidak memenuhi syarat kategori', () => {
    const promo = makePromo({ scope: 'category', scopeTarget: 'Makanan' });
    expect(isPromoApplicable(promo, 10000, { cartItems: [makeCustomItem()], menus })).toBe(false);
    expect(isPromoApplicable(promo, 20000, { cartItems: [makeCustomItem(), makeMenuItem()], menus })).toBe(true);
  });

  it('diskon transaksi (scope all) TETAP berlaku atas subtotal yang memuat item custom', () => {
    const promo = makePromo({ type: 'percentage', scope: 'all', value: 10 });
    const ctx = { cartItems: [makeCustomItem({ subtotal: 10000 }), makeMenuItem({ subtotal: 10000 })], menus };
    expect(calculatePromoDiscount(promo, 20000, ctx)).toBe(2000);
  });

  it('eligibleItemQty: scope all menghitung item custom, scope menu tidak', () => {
    const promoAll = makePromo({ scope: 'all', minQty: 3 });
    const promoMenu = makePromo({ scope: 'menu', scopeTarget: 'm1', minQty: 3 });
    const ctx = { cartItems: [makeCustomItem({ quantity: 2 }), makeMenuItem({ quantity: 1 })], menus };
    expect(eligibleItemQty(promoAll, ctx)).toBe(3);
    expect(eligibleItemQty(promoMenu, ctx)).toBe(1);
  });
});

// ============================================================
// GUARD TIKET DAPUR — item custom TIDAK dicetak tanpa target eksplisit
// ============================================================
let windowBackup: any;
let documentBackup: any;

beforeEach(() => {
  windowBackup = (globalThis as any).window;
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

function installFakeDom() {
  const createdIframes: any[] = [];
  const doc = {
    getElementById: vi.fn(() => null),
    createElement: vi.fn(() => {
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

function makeBaseSettings(overrides: Record<string, any> = {}): AppSettings {
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
  } as AppSettings;
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

async function loadPrinterModule() {
  vi.resetModules();
  return await import('../utils/printer');
}

describe('printer — guard tiket dapur item custom (P.4)', () => {
  it('custom TANPA kitchenTarget → TIDAK dicetak ke printer dapur mana pun', async () => {
    const { doc } = installFakeDom();
    const mod = await loadPrinterModule();
    const settings = makeBaseSettings({
      kitchenPrinters: [
        makeKitchenPrinter({ id: 'kp-1', name: 'Dapur 1', targetCategory: 'Makanan' }),
        makeKitchenPrinter({ id: 'kp-2', name: 'Bar', targetCategory: 'Minuman' }),
      ],
    });

    const results = await mod.printReceipt(
      makeReceiptData([makeCustomItem({ kitchenTarget: undefined })]),
      settings,
      'kitchen'
    );

    // Tidak ada tiket: tidak ada iframe yang dibuat; hasil sukses "nothing to print"
    expect(doc.createElement).not.toHaveBeenCalled();
    expect(results.every((r: any) => r.status === 'success')).toBe(true);
  });

  // v4.10 R-A2: deteksi via menuId prefix 'custom:' (fallback saat flag isCustom hilang) —
  // row lama/build lain yang flag-nya tidak tersimpan tetap tidak nyasar ke dapur.
  it('custom dengan menuId prefix custom: TANPA flag isCustom & tanpa target → tetap TIDAK dicetak (R-A2)', async () => {
    const { doc } = installFakeDom();
    const mod = await loadPrinterModule();
    const settings = makeBaseSettings({
      kitchenPrinters: [makeKitchenPrinter({ id: 'kp-1', name: 'Dapur 1', targetCategory: 'Makanan' })],
    });

    const legacyItem = makeCustomItem({ kitchenTarget: undefined });
    delete (legacyItem as any).isCustom; // simulasi row lama tanpa flag

    const results = await mod.printReceipt(makeReceiptData([legacyItem]), settings, 'kitchen');

    expect(doc.createElement).not.toHaveBeenCalled();
    expect(results.every((r: any) => r.status === 'success')).toBe(true);
  });

  // v4.10 R-A2: fallback prefix TIDAK mengubah perilaku item MENU biasa yang isCustom-nya false
  it('REGRESI R-A2: item menu biasa tanpa kitchenTarget tetap dicetak ke semua printer dapur aktif', async () => {
    const { doc, createdIframes } = installFakeDom();
    const mod = await loadPrinterModule();
    const settings = makeBaseSettings({
      kitchenPrinters: [
        makeKitchenPrinter({ id: 'kp-1', name: 'Dapur 1', targetCategory: 'Makanan' }),
        makeKitchenPrinter({ id: 'kp-2', name: 'Bar', targetCategory: 'Minuman' }),
      ],
    });

    // menuId normal (bukan prefix custom:) + isCustom false + tanpa target → perilaku lama (cetak semua)
    const normal = makeMenuItem({ kitchenTarget: undefined });
    await mod.printReceipt(makeReceiptData([normal]), settings, 'kitchen');

    expect(createdIframes.length).toBe(2); // kedua printer mencetak
  });

  it('custom DENGAN kitchenTarget "Makanan" → dicetak HANYA ke printer target itu', async () => {
    const { doc, createdIframes } = installFakeDom();
    const mod = await loadPrinterModule();
    const settings = makeBaseSettings({
      kitchenPrinters: [
        makeKitchenPrinter({ id: 'kp-1', name: 'Dapur Makanan', targetCategory: 'Makanan' }),
        makeKitchenPrinter({ id: 'kp-2', name: 'Bar', targetCategory: 'Minuman' }),
      ],
    });

    const results = await mod.printReceipt(
      makeReceiptData([makeCustomItem({ kitchenTarget: 'Makanan' })]),
      settings,
      'kitchen'
    );

    expect(results).toHaveLength(2);
    expect(results.find((r: any) => r.printer === 'Dapur Makanan')?.status).toBe('success');
    // Hanya 1 iframe → hanya printer Makanan yang benar-benar mencetak, Bar "nothing to print"
    expect(createdIframes.length).toBe(1);
  });

  it('REGRESI: item menu biasa tanpa target tetap dicetak ke SEMUA printer dapur aktif', async () => {
    const { doc, createdIframes } = installFakeDom();
    const mod = await loadPrinterModule();
    const settings = makeBaseSettings({
      kitchenPrinters: [
        makeKitchenPrinter({ id: 'kp-1', name: 'Dapur 1', targetCategory: 'Makanan' }),
        makeKitchenPrinter({ id: 'kp-2', name: 'Bar', targetCategory: 'Minuman' }),
      ],
    });

    const results = await mod.printReceipt(
      makeReceiptData([makeMenuItem({ kitchenTarget: undefined })]),
      settings,
      'kitchen'
    );

    expect(results).toHaveLength(2);
    // Kedua printer mencetak (2 iframe) — perilaku lama tidak berubah
    expect(createdIframes.length).toBe(2);
  });

  it('REGRESI: item menu dengan target tidak cocok → tidak dicetak ke printer itu', async () => {
    const { doc } = installFakeDom();
    const mod = await loadPrinterModule();
    const settings = makeBaseSettings({
      kitchenPrinters: [makeKitchenPrinter({ id: 'kp-1', name: 'Bar', targetCategory: 'Minuman' })],
    });

    await mod.printReceipt(
      makeReceiptData([makeMenuItem({ kitchenTarget: 'Makanan' })]),
      settings,
      'kitchen'
    );

    expect(doc.createElement).not.toHaveBeenCalled();
  });
});

// ============================================================
// InventoryItem type tidak berubah — sanity guard helper hpp manual
// ============================================================
describe('customHpp di snapshot (sanity)', () => {
  it('createSnapshotForCartItems menyertakan customHpp hanya bila diisi', () => {
    const snap = createSnapshotForCartItems([makeCustomItem()], menus, []);
    expect(snap.itemsWithSnapshot[0].recipeSnapshot).toEqual([]);

    const snap2 = createSnapshotForCartItems([makeCustomItem({ customHpp: 3000 })], menus, []);
    expect(snap2.itemsWithSnapshot[0].cogs).toBe(3000);
  });
});