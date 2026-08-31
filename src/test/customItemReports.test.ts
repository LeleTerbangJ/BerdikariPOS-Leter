// ============================================================
// v4.10 P.4 — LABA KOTOR item non-menu di laporan (helper murni)
//
// - buildMenuSalesSummary   : ringkasan shift (cetak Layout) —
//   bucket "Item Non-Menu" menampilkan profit = revenue − customHpp.
// - buildMenuProfitability  : tabel Profitabilitas Menu Dashboard —
//   baris bucket non-menu memuat profit & margin dari customHpp.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildMenuSalesSummary } from '../utils/menuSalesSummary';
import { buildMenuProfitability } from '../utils/menuProfitability';
import { buildCategorySales } from '../utils/categorySales';
import { CUSTOM_ITEM_BUCKET_NAME, CUSTOM_ITEM_BUCKET_KEY, CUSTOM_MENU_ID_PREFIX, customItemReportKey } from '../utils/customItem';
import type { CartItem, Transaction, Menu, InventoryItem } from '../types';

function makeCustomItem(name: string, price: number, qty: number, customHpp?: number): CartItem {
  return {
    lineId: `custom-${Math.random().toString(36).slice(2, 8)}`,
    menuId: `${CUSTOM_MENU_ID_PREFIX}${Math.random().toString(36).slice(2, 12)}`,
    name,
    basePrice: price,
    quantity: qty,
    temperature: 'Hangat',
    sugar: 'None',
    addons: [],
    subtotal: price * qty,
    isCustom: true,
    // meniru snapshot engine: hpp/cogs = customHpp × qty
    hpp: customHpp ? customHpp * qty : 0,
    cogs: customHpp ? customHpp * qty : 0,
  };
}

function makeMenuItem(menuId: string, name: string, price: number, qty: number, hpp?: number): CartItem {
  return {
    lineId: `${menuId}-${qty}`,
    menuId,
    name,
    basePrice: price,
    quantity: qty,
    temperature: 'Hangat',
    sugar: 'None',
    addons: [],
    subtotal: price * qty,
    hpp,
    cogs: hpp,
  };
}

// ============================================================
// buildMenuSalesSummary — ringkasan shift (Layout print)
// ============================================================
describe('buildMenuSalesSummary — laba kotor bucket Item Non-Menu (P.4)', () => {
  it('custom dengan customHpp: baris bucket menampilkan profit = revenue − customHpp×qty', () => {
    const rows = buildMenuSalesSummary([
      {
        items: [
          makeCustomItem('Sambal', 10000, 3, 4000),  // revenue 30.000, hpp 12.000
          makeCustomItem('Kerupuk', 2000, 2),        // revenue 4.000, hpp 0 (tanpa modal)
        ],
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(CUSTOM_ITEM_BUCKET_NAME);
    expect(rows[0].qty).toBe(5);
    expect(rows[0].revenue).toBe(34000);
    expect(rows[0].hpp).toBe(12000);
    expect(rows[0].profit).toBe(22000); // laba kotor = revenue − customHpp
  });

  it('custom tanpa customHpp: profit = revenue penuh (margin 100% — tanpa modal tercatat)', () => {
    const rows = buildMenuSalesSummary([
      { items: [makeCustomItem('Sambal', 10000, 2)] },
    ]);
    expect(rows[0].profit).toBe(20000);
    expect(rows[0].hpp).toBe(0);
  });

  it('campuran menu + custom: baris menu sesuai aturan lama (by nama), bucket non-menu terpisah dgn hppnya', () => {
    const rows = buildMenuSalesSummary([
      {
        items: [
          makeMenuItem('m1', 'Es Teh', 5000, 2, 3000), // revenue 10.000, hpp 3.000
          makeMenuItem('m1', 'Es Teh', 5000, 1, 1500), // merge by nama → qty 3, revenue 15.000, hpp 4.500
          makeCustomItem('Sambal', 10000, 1, 6000),
        ],
      },
    ]);

    expect(rows).toHaveLength(2);
    const menuRow = rows.find((r) => r.name === 'Es Teh')!;
    expect(menuRow.qty).toBe(3);
    expect(menuRow.revenue).toBe(15000);
    expect(menuRow.hpp).toBe(4500); // menu tetap dihitung HPP snapshot

    const bucket = rows.find((r) => r.name === CUSTOM_ITEM_BUCKET_NAME)!;
    expect(bucket.revenue).toBe(10000);
    expect(bucket.hpp).toBe(6000);
    expect(bucket.profit).toBe(4000);
  });

  it('bundle PARENT dilewati (child dihitung) & urut by qty desc', () => {
    const rows = buildMenuSalesSummary([
      {
        items: [
          makeCustomItem('Sambal', 10000, 2),  // bucket qty 2
          { ...makeMenuItem('b1', 'Paket', 20000, 1, 5000), isBundle: true }, // skip
          { ...makeMenuItem('c1', 'Nasi', 5000, 1, 2000), parentLineId: 'b1' }, // child
        ],
      },
    ]);

    const bucket = rows.find((r) => r.name === CUSTOM_ITEM_BUCKET_NAME)!;
    expect(bucket.qty).toBe(2);
    const child = rows.find((r) => r.name === 'Nasi')!;
    expect(child.qty).toBe(1);
    // Sorted: bucket qty 2 di atas Nasi qty 1
    expect(rows[0].name).toBe(CUSTOM_ITEM_BUCKET_NAME);
  });
});

// ============================================================
// buildMenuProfitability — tabel Dashboard (30 hari)
// ============================================================
const menus: Menu[] = [
  { id: 'm1', name: 'Es Teh', category: 'Minuman', price: 5000, ingredients: { gula: 2 }, availableAddons: [] },
];

const inv: InventoryItem[] = [
  { id: 'gula', name: 'Gula', stock: 100, unit: 'pcs', costPerUnit: 1000, minStock: 0 },
];

function makeTx(id: string, date: string, items: CartItem[], over: Partial<Transaction> = {}): Transaction {
  return {
    id,
    queueNumber: 1,
    date,
    items,
    subtotal: items.reduce((a, b) => a + b.subtotal, 0),
    discount: 0,
    totalAmount: items.reduce((a, b) => a + b.subtotal, 0),
    paymentMethod: 'Cash',
    kitchenStatus: 'Done',
    txStatus: 'Selesai',
    cashierId: 'u1',
    cashierName: 'Kasir',
    hpp: items.reduce((a, b) => a + (b.hpp || 0), 0),
    ...over,
  } as Transaction;
}

const NOW = new Date('2026-08-27T10:00:00.000Z');
// 20 hari lalu → masih dalam jendela 30 hari
const OLD = new Date(NOW.getTime() - 20 * 24 * 3600 * 1000).toISOString();
// 40 hari lalu → di luar jendela
const TOO_OLD = new Date(NOW.getTime() - 40 * 24 * 3600 * 1000).toISOString();

describe('buildMenuProfitability — baris bucket Item Non-Menu (P.4)', () => {
  it('custom dengan customHpp: profit & margin dihitung dari revenue − customHpp×qty', () => {
    const rows = buildMenuProfitability(
      [makeTx('t1', OLD, [makeCustomItem('Sambal', 10000, 2, 4000)])], // revenue 20.000, hpp 8.000
      menus,
      inv,
      NOW
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(CUSTOM_ITEM_BUCKET_NAME);
    expect(rows[0].revenue).toBe(20000);
    expect(rows[0].hpp).toBe(8000);
    expect(rows[0].profit).toBe(12000);
    expect(rows[0].margin).toBe(60); // (12000/20000)*100
  });

  it('custom tanpa customHpp: profit = revenue, margin 100%', () => {
    const rows = buildMenuProfitability(
      [makeTx('t2', OLD, [makeCustomItem('Kerupuk', 2000, 5)])],
      menus,
      inv,
      NOW
    );
    expect(rows[0].profit).toBe(10000);
    expect(rows[0].margin).toBe(100);
  });

  it('transaksi di luar 30 hari / bukan Selesai tidak ikut dihitung', () => {
    const rows = buildMenuProfitability(
      [
        makeTx('t3', TOO_OLD, [makeCustomItem('Sambal', 10000, 1, 5000)]),
        makeTx('t4', OLD, [makeCustomItem('Sambal', 10000, 1, 5000)], { txStatus: 'Cancel' }),
        makeTx('t5', OLD, [makeCustomItem('Sambal', 10000, 1, 5000)], { refunded: true }),
      ],
      menus,
      inv,
      NOW
    );
    expect(rows).toHaveLength(0);
  });

  it('campuran menu + custom: dua baris, masing-masing dgn profit yang benar', () => {
    const rows = buildMenuProfitability(
      [
        makeTx('t6', OLD, [
          makeMenuItem('m1', 'Es Teh', 5000, 2, 4000), // revenue 10.000, hpp 4.000 → profit 6.000, margin 60
          makeCustomItem('Sambal', 10000, 1, 3000),    // profit 7.000, margin 70
        ]),
      ],
      menus,
      inv,
      NOW
    );

    expect(rows).toHaveLength(2);
    // sorted by profit desc → custom (7.000) di atas Es Teh (6.000)
    expect(rows[0].name).toBe(CUSTOM_ITEM_BUCKET_NAME);
    expect(rows[0].profit).toBe(7000);
    expect(rows[1].name).toBe('Es Teh');
    expect(rows[1].profit).toBe(6000);
  });

  it('REGRESI: item menu legacy tanpa hpp memakai fallback (costPerUnit bahan) & split fresh equal tetap dinormalisasi', () => {
    // Legacy: item tanpa hpp/cogs → fallback calculateMenuHPP (gula 1000×2 = 2000 per porsi) × qty
    const legacy = makeMenuItem('m1', 'Es Teh', 5000, 2);
    delete (legacy as any).hpp;
    delete (legacy as any).cogs;

    // Sub-bill split FRESH equal (splitIndex + totalSplitCount, tanpa splitParentId) → divisor 2.
    // Filter laporan hanya mengecualikan tx ber-splitParentId; sub-bill fresh lolos & dibagi kontribusinya.
    const subBill = makeTx('t7', OLD, [makeMenuItem('m1', 'Es Teh', 5000, 2, 4000)], {
      splitIndex: 1,
      totalSplitCount: 2,
      subtotal: 8000, // Σ item (10000) − subtotal ≥ 1 → isEqualSplitSubBill true (mode equal)
    });

    const rows = buildMenuProfitability(
      [makeTx('t8', OLD, [legacy]), subBill],
      menus,
      inv,
      NOW
    );

    const row = rows.find((r) => r.name === 'Es Teh')!;
    // legacy: hpp fallback 2000×2 = 4000; sub-bill: hpp 4000/2 = 2000 → total 6000
    expect(row.hpp).toBe(6000);
    // revenue: 10000 (legacy) + 10000/2 (split) = 15000
    expect(row.revenue).toBe(15000);

    // Sub-bill ber-splitParentId TETAP dikecualikan dari profitabilitas (perilaku lama)
    const rowsWithParent = buildMenuProfitability(
      [makeTx('t9', OLD, [makeMenuItem('m1', 'Es Teh', 5000, 2, 4000)], {
        splitParentId: 'parent-1',
        totalSplitCount: 2,
      })],
      menus,
      inv,
      NOW
    );
    expect(rowsWithParent).toHaveLength(0);
  });
});

// ============================================================
// R-A4 — buildCategorySales: item non-menu → bucket "Item Non-Menu"
// ============================================================
describe('buildCategorySales — item non-menu ke bucket "Item Non-Menu" (R-A4)', () => {
  const menusWithCat: Menu[] = [
    { id: 'm1', name: 'Es Teh', category: 'Minuman', price: 5000, ingredients: {}, availableAddons: [] },
    { id: 'm2', name: 'Nasi Goreng', category: 'Makanan', price: 15000, ingredients: {}, availableAddons: [] },
  ];

  it('item custom masuk bucket "Item Non-Menu" (bukan "Lainnya") & digabung semua nama', () => {
    const rows = buildCategorySales(
      [
        makeTx('t1', new Date().toISOString(), [
          makeCustomItem('Sambal', 10000, 2),
          makeCustomItem('Kerupuk', 2000, 1),
        ]),
      ],
      menusWithCat
    );

    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe(CUSTOM_ITEM_BUCKET_NAME);
    expect(rows[0][1].revenue).toBe(22000);
    expect(rows[0][1].qty).toBe(3);
  });

  it('campuran: kategori menu + bucket custom terpisah, urut by revenue desc', () => {
    const rows = buildCategorySales(
      [
        makeTx('t2', new Date().toISOString(), [
          makeMenuItem('m1', 'Es Teh', 5000, 2),      // Minuman 10.000
          makeMenuItem('m2', 'Nasi Goreng', 15000, 1), // Makanan 15.000
          makeCustomItem('Sambal', 10000, 1),          // Item Non-Menu 10.000
        ]),
      ],
      menusWithCat
    );

    expect(rows).toHaveLength(3);
    expect(rows[0][0]).toBe('Makanan');       // 15.000 terbesar
    expect(rows[1][0]).toBe('Minuman');       // 10.000
    expect(rows[2][0]).toBe(CUSTOM_ITEM_BUCKET_NAME); // 10.000, tie-break stabil
    const bucket = rows.find(([cat]) => cat === CUSTOM_ITEM_BUCKET_NAME)!;
    expect(bucket[1].revenue).toBe(10000);
    expect(bucket[1].qty).toBe(1);
  });

  it('menu tanpa kategori tetap "Lainnya"; custom tidak ikut tercampur', () => {
    const rows = buildCategorySales(
      [
        makeTx('t3', new Date().toISOString(), [
          makeMenuItem('m3', 'Tanpa Kategori', 7000, 1), // tidak ada di menus → Lainnya
          makeCustomItem('Sambal', 10000, 1),
        ]),
      ],
      menusWithCat
    );

    const lainnya = rows.find(([cat]) => cat === 'Lainnya')!;
    expect(lainnya[1].revenue).toBe(7000);
    const bucket = rows.find(([cat]) => cat === CUSTOM_ITEM_BUCKET_NAME)!;
    expect(bucket[1].revenue).toBe(10000);
    // Tidak ada penggabungan antara "Lainnya" dan bucket custom
    expect(rows).toHaveLength(2);
  });

  it('child bundle dilewati; sub-bill split equal dinormalisasi divisor', () => {
    const rows = buildCategorySales(
      [
        makeTx('t4', new Date().toISOString(), [
          { ...makeMenuItem('m1', 'Es Teh', 5000, 2), isBundle: true },
          { ...makeMenuItem('c1', 'Nasi', 5000, 1), isBundleChild: true },
          makeCustomItem('Sambal', 10000, 2),
        ]),
        {
          ...makeTx('t5', new Date().toISOString(), [makeCustomItem('Sambal', 10000, 2)]),
          splitIndex: 1,
          totalSplitCount: 2,
          // sub-bill split equal: Σ item (20.000) ≠ subtotal (10.000) → divisor 2
          subtotal: 10000,
        },
      ],
      menusWithCat
    );

    const bucket = rows.find(([cat]) => cat === CUSTOM_ITEM_BUCKET_NAME)!;
    // 2 (t4) + 2/2 (t5 split) = 3; revenue 20.000 + 10.000 = 30.000
    expect(bucket[1].qty).toBe(3);
    expect(bucket[1].revenue).toBe(30000);
  });
});

// ============================================================
// R-A5 — key bucket sintetis anti-bentrok nama menu
// ============================================================
describe('R-A5 — key sintetis bucket non-menu (anti-bentrok nama menu)', () => {
  it('menu nyata bernama "Item Non-Menu" tidak tercampur ke bucket custom di ringkasan shift', () => {
    const rows = buildMenuSalesSummary([
      {
        items: [
          // Menu NYATA yang kebetulan bernama seperti bucket
          makeMenuItem('m9', CUSTOM_ITEM_BUCKET_NAME, 5000, 1, 1000),
          // Item custom asli
          makeCustomItem('Sambal', 10000, 1, 4000),
        ],
      },
    ]);

    // Dua baris terpisah: menu asli (by nama) vs custom (key sintetis)
    expect(rows).toHaveLength(2);
    const menuRow = rows.find((r) => r.name === CUSTOM_ITEM_BUCKET_NAME && r.hpp === 1000)!;
    const bucketRow = rows.find((r) => r.name === CUSTOM_ITEM_BUCKET_NAME && r.hpp === 4000)!;
    expect(menuRow.revenue).toBe(5000);
    expect(bucketRow.revenue).toBe(10000);
    expect(bucketRow.profit).toBe(6000); // 10.000 − 4.000
    expect(menuRow).not.toBe(bucketRow);
  });

  it('customItemReportKey: custom → key sintetis; menu → menuId; tidak pernah sama', () => {
    const custom = makeCustomItem('Sambal', 10000, 1);
    const menu = makeMenuItem('m1', 'Es Teh', 5000, 1);
    expect(customItemReportKey(custom)).toBe(CUSTOM_ITEM_BUCKET_KEY);
    expect(customItemReportKey(menu)).toBe('m1');
    expect(customItemReportKey(custom)).not.toBe(customItemReportKey(menu));
  });
});