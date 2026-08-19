import { describe, it, expect } from 'vitest';
import {
  IDB_BACKED_KEYS,
  FULL_RESET_KEYS,
  OPERATIONAL_CLEAR_KEYS,
  OPERATIONAL_WIPE_TABLES,
  FULL_WIPE_TABLES,
  splitClearPlan,
  reseedPlan,
} from '../utils/dataManager';

/** Semua key persist yang dipakai store (dari src/store/*.ts). */
const ALL_PERSIST_KEYS = [
  'rempah-auth',
  'rempah-menus',
  'rempah-inventory',
  'rempah-transactions',
  'rempah-cart',
  'rempah-customers',
  'rempah-shifts',
  'rempah-settings',
  'rempah-stock-logs',
  'rempah-promos',
  'rempah-audit-logs',
  'rempah-stock-opnames',
  'rempah-cash-movements',
];

// ============================================================
// TO DO 12.1.1 — IndexedDB tidak boleh bocor dari reset
// ============================================================

describe('IDB_BACKED_KEYS (12.1.1)', () => {
  it('store IndexedDB (transactions & audit-logs) masuk daftar IDB', () => {
    expect(IDB_BACKED_KEYS).toContain('rempah-transactions');
    expect(IDB_BACKED_KEYS).toContain('rempah-audit-logs');
  });
});

describe('FULL_RESET_KEYS (Reset ke Default / Factory Reset)', () => {
  it('mencakup SEMUA key persist — tidak ada yang lolos dari reset penuh', () => {
    for (const key of ALL_PERSIST_KEYS) {
      expect(FULL_RESET_KEYS, `harus memuat ${key}`).toContain(key);
    }
  });

  it('mencakup key IndexedDB (anti data ghost)', () => {
    expect(FULL_RESET_KEYS).toContain('rempah-transactions');
    expect(FULL_RESET_KEYS).toContain('rempah-audit-logs');
  });

  it('mencakup Rekap Kas (12.1.2)', () => {
    expect(FULL_RESET_KEYS).toContain('rempah-cash-movements');
  });

  it('tidak ada duplikat', () => {
    expect(new Set(FULL_RESET_KEYS).size).toBe(FULL_RESET_KEYS.length);
  });
});

describe('OPERATIONAL_CLEAR_KEYS (Bersihkan Data Transaksi)', () => {
  it('menghapus semua data operasional', () => {
    const ops = [
      'rempah-transactions',
      'rempah-cart',
      'rempah-shifts',
      'rempah-customers',
      'rempah-stock-logs',
      'rempah-audit-logs',
      'rempah-promos',
      'rempah-stock-opnames',
      'rempah-cash-movements', // 12.1.2: Rekap Kas ikut bersih
    ];
    for (const key of ops) {
      expect(OPERATIONAL_CLEAR_KEYS, `harus memuat ${key}`).toContain(key);
    }
  });

  it('MEMPERLAHANKAN master data (users/menus/inventory/settings)', () => {
    expect(OPERATIONAL_CLEAR_KEYS).not.toContain('rempah-auth');
    expect(OPERATIONAL_CLEAR_KEYS).not.toContain('rempah-menus');
    expect(OPERATIONAL_CLEAR_KEYS).not.toContain('rempah-inventory');
    expect(OPERATIONAL_CLEAR_KEYS).not.toContain('rempah-settings');
  });
});

// ============================================================
// TO DO 12.1.3 — resetToDefault vs factoryReset (reseed minimal)
// ============================================================

describe('reseedPlan (12.1.3)', () => {
  it('resetToDefault (demo) men-seed penuh: users + settings + menus + inventory', () => {
    expect(reseedPlan('demo')).toEqual({
      users: true,
      settings: true,
      menus: true,
      inventory: true,
    });
  });

  it('factoryReset men-seed MINIMAL: users + settings saja, TANPA menus/inventory demo', () => {
    expect(reseedPlan('factory')).toEqual({
      users: true,
      settings: true,
      menus: false,
      inventory: false,
    });
  });

  it('kedua mode selalu menyediakan akun login (users) & settings', () => {
    for (const kind of ['demo', 'factory'] as const) {
      const plan = reseedPlan(kind);
      expect(plan.users).toBe(true);
      expect(plan.settings).toBe(true);
    }
  });

  it('perbedaan nyata: factory reset tidak men-seed katalog demo ke cloud', () => {
    const demo = reseedPlan('demo');
    const factory = reseedPlan('factory');
    expect(demo.menus).not.toBe(factory.menus);
    expect(demo.inventory).not.toBe(factory.inventory);
  });
});

// ============================================================
// TO DO 12.1.4 — menu_components yatim ikut di-wipe (reset penuh)
// ============================================================

describe('cloud wipe tables (12.1.4 / 12.1.2)', () => {
  it('reset penuh (FULL_WIPE_TABLES) mencakup menu_components — anti bundle yatim', () => {
    expect(FULL_WIPE_TABLES).toContain('menu_components');
  });

  it('reset penuh mencakup SEMUA tabel (operasional + master)', () => {
    for (const table of OPERATIONAL_WIPE_TABLES) {
      expect(FULL_WIPE_TABLES, `harus memuat ${table}`).toContain(table);
    }
    for (const table of ['menus', 'inventory', 'users', 'settings']) {
      expect(FULL_WIPE_TABLES, `harus memuat ${table}`).toContain(table);
    }
  });

  it('Bersihkan Data Transaksi (OPERATIONAL) TIDAK menyentuh master data & menu_components', () => {
    expect(OPERATIONAL_WIPE_TABLES).not.toContain('menu_components');
    expect(OPERATIONAL_WIPE_TABLES).not.toContain('menus');
    expect(OPERATIONAL_WIPE_TABLES).not.toContain('inventory');
    expect(OPERATIONAL_WIPE_TABLES).not.toContain('users');
    expect(OPERATIONAL_WIPE_TABLES).not.toContain('settings');
  });

  it('OPERATIONAL tetap mencakup cash_movements (12.1.2)', () => {
    expect(OPERATIONAL_WIPE_TABLES).toContain('cash_movements');
  });

  it('tidak ada duplikat tabel di kedua daftar', () => {
    expect(new Set(FULL_WIPE_TABLES).size).toBe(FULL_WIPE_TABLES.length);
    expect(new Set(OPERATIONAL_WIPE_TABLES).size).toBe(OPERATIONAL_WIPE_TABLES.length);
  });

  it('OPERATIONAL_WIPE_TABLES menghapus tabel anak sebelum tabel induk (mencegah FK constraint error)', () => {
    const stockLogsIdx = OPERATIONAL_WIPE_TABLES.indexOf('stock_logs');
    const cashMovementsIdx = OPERATIONAL_WIPE_TABLES.indexOf('cash_movements');
    const txIdx = OPERATIONAL_WIPE_TABLES.indexOf('transactions');
    const shiftsIdx = OPERATIONAL_WIPE_TABLES.indexOf('shifts');

    expect(stockLogsIdx).toBeLessThan(txIdx);
    expect(cashMovementsIdx).toBeLessThan(shiftsIdx);
    expect(txIdx).toBeLessThan(shiftsIdx);
  });
});

describe('splitClearPlan (klasifikasi adapter)', () => {
  it('memisahkan key IndexedDB dari key localStorage', () => {
    const plan = splitClearPlan(['rempah-transactions', 'rempah-menus', 'rempah-audit-logs']);
    expect(plan.idbKeys).toEqual(['rempah-transactions', 'rempah-audit-logs']);
    expect(plan.localKeys).toEqual(['rempah-menus']);
  });

  it('empty input → rencana kosong', () => {
    expect(splitClearPlan([])).toEqual({ idbKeys: [], localKeys: [] });
  });

  it('semua key FULL_RESET_KEYS terklasifikasi (idb + local) tanpa kehilangan', () => {
    const plan = splitClearPlan(FULL_RESET_KEYS);
    expect([...plan.idbKeys, ...plan.localKeys].sort()).toEqual([...FULL_RESET_KEYS].sort());
    expect(plan.idbKeys.sort()).toEqual([...IDB_BACKED_KEYS].sort());
  });
});
