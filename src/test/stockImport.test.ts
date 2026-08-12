import { describe, it, expect } from 'vitest';
import {
  planCsvImportRow,
  findDriftedOpnameItems,
  resolveOpnameGate,
  shouldShowLargeDifferenceBanner,
  fillMissingItemReasons,
  parseActualStock,
} from '../utils/stockImport';
import type { InventoryItem, StockOpnameItem } from '../types';

function makeItem(id: string, stock: number, name = `Bahan ${id}`, unit = 'kg'): InventoryItem {
  return { id, name, stock, unit, costPerUnit: 1000, minStock: 5 } as InventoryItem;
}

const PARSED = { id: 'invA', name: 'Beras', stock: 10, unit: 'kg', costPerUnit: 5000, minStock: 3 };

// ============================================================
// TO DO 9.1 — log tipe 'import' untuk CSV import
// ============================================================

describe('planCsvImportRow (TO DO 9.1 — CSV import tercatat tipe import)', () => {
  it('item existing dengan stok berubah → action update + log type "import" (bukan "adjust")', () => {
    const plan = planCsvImportRow(makeItem('invA', 6), PARSED);
    expect(plan.action).toBe('update');
    expect(plan.log).toBeDefined();
    expect(plan.log!.type).toBe('import');
    expect(plan.log!.reason).toBe('Import CSV');
    expect(plan.log!.amount).toBe(4); // 10 - 6
    expect(plan.log!.stockBefore).toBe(6);
    expect(plan.log!.stockAfter).toBe(10);
  });

  it('item existing dengan stok SAMA → update tanpa log (tidak ada perubahan stok)', () => {
    const plan = planCsvImportRow(makeItem('invA', 10), PARSED);
    expect(plan.action).toBe('update');
    expect(plan.log).toBeUndefined();
  });

  it('item BARU → action create + log type "import" dengan stok awal (stockBefore 0)', () => {
    const plan = planCsvImportRow(undefined, PARSED);
    expect(plan.action).toBe('create');
    expect(plan.log!.type).toBe('import');
    expect(plan.log!.stockBefore).toBe(0);
    expect(plan.log!.stockAfter).toBe(10);
    expect(plan.log!.amount).toBe(10);
  });

  it('stok turun → amount negatif (delta benar)', () => {
    const plan = planCsvImportRow(makeItem('invA', 15), PARSED);
    expect(plan.log!.amount).toBe(-5);
  });
});

// ============================================================
// TO DO 9.2 — deteksi drift stok opname (race lintas device)
// ============================================================

// ============================================================
// TO DO 10.1 — mode blind: tutup oracle ±10%
// ============================================================

describe('resolveOpnameGate (TO DO 10.1 — jalur konfirmasi seragam untuk Staf Gudang)', () => {
  it('Staf Gudang + selisih kecil → TETAP PIN (jalur seragam, tidak ada sinyal diferensial)', () => {
    expect(resolveOpnameGate(true, false)).toBe('pin');
  });

  it('Staf Gudang + selisih besar → PIN', () => {
    expect(resolveOpnameGate(true, true)).toBe('pin');
  });

  it('non-staff + selisih besar → PIN; non-staff + selisih kecil → ConfirmDialog biasa', () => {
    expect(resolveOpnameGate(false, true)).toBe('pin');
    expect(resolveOpnameGate(false, false)).toBe('confirm');
  });
});

describe('shouldShowLargeDifferenceBanner (TO DO 10.1 — banner tidak bocor ke Staf Gudang)', () => {
  it('banner HANYA untuk non-staff dengan selisih besar', () => {
    expect(shouldShowLargeDifferenceBanner(false, true)).toBe(true);
    expect(shouldShowLargeDifferenceBanner(false, false)).toBe(false);
    expect(shouldShowLargeDifferenceBanner(true, true)).toBe(false); // staff: jangan tampilkan
    expect(shouldShowLargeDifferenceBanner(true, false)).toBe(false);
  });
});

// ============================================================
// TO DO 10.4 — clamp stok aktual opname (negatif/NaN tidak masuk inventory)
// ============================================================

describe('parseActualStock (TO DO 10.4 — clamp stok aktual opname)', () => {
  it('nilai negatif "-5" → 0 (tidak bisa masuk inventory)', () => {
    expect(parseActualStock('-5')).toBe(0);
  });

  it('negatif desimal "-0.5" → 0', () => {
    expect(parseActualStock('-0.5')).toBe(0);
  });

  it('NaN / teks / kosong → 0 (fallback, bukan NaN masuk store)', () => {
    expect(parseActualStock('abc')).toBe(0);
    expect(parseActualStock('')).toBe(0);
  });

  it('nol → 0', () => {
    expect(parseActualStock('0')).toBe(0);
  });

  it('positif normal → dipertahankan apa adanya', () => {
    expect(parseActualStock('12.5')).toBe(12.5);
    expect(parseActualStock(' 3.7 ')).toBe(3.7);
  });
});

// ============================================================
// TO DO 10.3 — alasan penyesuaian wajib untuk Staf Gudang pasca-PIN
// ============================================================

describe('fillMissingItemReasons (TO DO 10.3 — alasan utama diterapkan ke item berselisih)', () => {
  const opnameItem = (over: Partial<StockOpnameItem>): StockOpnameItem => ({
    inventoryId: 'invA', inventoryName: 'Beras', unit: 'kg',
    systemStock: 100, actualStock: 95, difference: -5,
    costPerUnit: 5000, lossValue: 25000, reason: '',
    ...over,
  });

  it('item berselisih dengan reason kosong → diisi alasan utama', () => {
    const filled = fillMissingItemReasons([opnameItem({})], 'Basi');
    expect(filled[0].reason).toBe('Basi');
  });

  it('item berselisih dengan reason "-" → diisi alasan utama', () => {
    const filled = fillMissingItemReasons([opnameItem({ reason: '-' })], 'Penyusutan');
    expect(filled[0].reason).toBe('Penyusutan');
  });

  it('item yang SUDAH punya alasan → tidak ditimpa', () => {
    const filled = fillMissingItemReasons([opnameItem({ reason: 'Bahan Rusak' })], 'Basi');
    expect(filled[0].reason).toBe('Bahan Rusak');
  });

  it('item dengan difference 0 (tidak berselisih) → tidak diisi', () => {
    const filled = fillMissingItemReasons([opnameItem({ difference: 0, reason: '' })], 'Basi');
    expect(filled[0].reason).toBe('');
  });

  it('reason kosong → array dikembalikan apa adanya (no-op)', () => {
    const items = [opnameItem({})];
    expect(fillMissingItemReasons(items, '')).toBe(items);
  });
});

describe('findDriftedOpnameItems (TO DO 9.2 — anti lost update)', () => {
  const writeItem = (over: Partial<{ inventoryId: string; systemStock: number; difference: number }>) => ({
    inventoryId: 'invA',
    inventoryName: 'Beras',
    unit: 'kg',
    systemStock: 100,
    difference: 3, // akan ditulis
    ...over,
  });

  it('stok berubah di perangkat lain (100 → 95) → terdeteksi dengan nilai lama & baru', () => {
    const drifted = findDriftedOpnameItems([writeItem({})], [makeItem('invA', 95)]);
    expect(drifted).toHaveLength(1);
    expect(drifted[0]).toEqual({
      inventoryId: 'invA',
      name: 'Beras',
      unit: 'kg',
      systemStock: 100,
      currentStock: 95,
    });
  });

  it('stok TIDAK berubah → tidak ada drift (tidak mengganggu alur normal)', () => {
    const drifted = findDriftedOpnameItems([writeItem({})], [makeItem('invA', 100)]);
    expect(drifted).toHaveLength(0);
  });

  it('item dengan difference 0 (tidak akan ditulis) → dilewati walau stoknya berubah', () => {
    const drifted = findDriftedOpnameItems(
      [writeItem({ difference: 0 })],
      [makeItem('invA', 95)]
    );
    expect(drifted).toHaveLength(0);
  });

  it('item yang tidak ada di inventory → dianggap tidak drift (fallback systemStock)', () => {
    const drifted = findDriftedOpnameItems([writeItem({})], []);
    expect(drifted).toHaveLength(0);
  });

  it('perbedaan floating-point kecil (< 1e-9) → tidak drift (toleransi)', () => {
    const drifted = findDriftedOpnameItems([writeItem({})], [makeItem('invA', 100.0000000001)]);
    expect(drifted).toHaveLength(0);
  });

  it('beberapa item: hanya yang drift yang dilaporkan', () => {
    const items = [
      writeItem({ inventoryId: 'invA', systemStock: 100, difference: 3 }),
      writeItem({ inventoryId: 'invB', systemStock: 50, difference: -2 }),
      writeItem({ inventoryId: 'invC', systemStock: 20, difference: 1 }),
    ];
    const drifted = findDriftedOpnameItems(items, [
      makeItem('invA', 95), // drift
      makeItem('invB', 50), // sama
      makeItem('invC', 18), // drift
    ]);
    expect(drifted.map((d) => d.inventoryId)).toEqual(['invA', 'invC']);
  });
});
