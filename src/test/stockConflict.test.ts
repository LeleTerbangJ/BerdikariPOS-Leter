import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectStockConflicts } from '../utils/stockConflict';
import type { InventoryItem } from '../types';

// ============================================================================
// Pure helper detectStockConflicts
// ============================================================================

function item(id: string, name: string, stock: number, unit = 'pcs'): InventoryItem {
  return { id, name, stock, unit, costPerUnit: 1000 };
}

describe('detectStockConflicts (v4.7 O-7)', () => {
  it('cloud > lokal → konflik terdeteksi dengan diff benar', () => {
    const local = new Map([['kopi', item('kopi', 'Kopi', 8)]]);
    const cloud = [item('kopi', 'Kopi', 12)];
    const conflicts = detectStockConflicts(local, cloud);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ingredientId).toBe('kopi');
    expect(conflicts[0].localBefore).toBe(8);
    expect(conflicts[0].cloudNow).toBe(12);
    expect(conflicts[0].diff).toBe(4);
  });

  it('cloud <= lokal (device lain menjual lebih dulu / sama) → TIDAK dibunyikan', () => {
    const local = new Map([
      ['kopi', item('kopi', 'Kopi', 8)],
      ['gula', item('gula', 'Gula', 8)],
    ]);
    const cloud = [item('kopi', 'Kopi', 5), item('gula', 'Gula', 8)];
    expect(detectStockConflicts(local, cloud)).toHaveLength(0);
  });

  it('perubahan rounding (≤ 0.01) diabaikan', () => {
    const local = new Map([['susu', item('susu', 'Susu', 10.5)]]);
    const cloud = [item('susu', 'Susu', 10.501)];
    expect(detectStockConflicts(local, cloud)).toHaveLength(0);
  });

  it('item baru dari cloud (tidak ada di lokal) bukan konflik', () => {
    const local = new Map([['kopi', item('kopi', 'Kopi', 8)]]);
    const cloud = [item('kopi', 'Kopi', 8), item('teh', 'Teh', 5)];
    expect(detectStockConflicts(local, cloud)).toHaveLength(0);
  });

  it('diurutkan diff terbesar dulu', () => {
    const local = new Map([
      ['a', item('a', 'A', 10)],
      ['b', item('b', 'B', 10)],
      ['c', item('c', 'C', 10)],
    ]);
    const cloud = [item('a', 'A', 11), item('b', 'B', 30), item('c', 'C', 15)];
    const conflicts = detectStockConflicts(local, cloud);
    expect(conflicts.map((c) => c.ingredientId)).toEqual(['b', 'c', 'a']);
  });
});

// ============================================================================
// Integrasi: inventoryStore.loadFromCloud mengisi stockConflicts
// ============================================================================

vi.mock('../lib/cloudSync', () => ({
  fetchInventoryFromCloud: vi.fn(),
  syncInventoryItem: vi.fn(),
  syncInventoryStock: vi.fn(),
  deleteInventoryCloud: vi.fn(),
}));

import { useInventoryStore } from '../store/inventoryStore';
import { fetchInventoryFromCloud } from '../lib/cloudSync';

describe('inventoryStore — stockConflicts saat sync (v4.7 O-7)', () => {
  beforeEach(() => {
    useInventoryStore.setState({ items: [], stockConflicts: [] });
    (fetchInventoryFromCloud as any).mockReset();
  });

  it('loadFromCloud mendeteksi konflik & clearStockConflicts mengosongkan', async () => {
    // Lokal: kopi 8 (dipotong device ini, belum sync)
    useInventoryStore.setState({ items: [item('kopi', 'Kopi', 8)] });
    // Cloud: kopi 12 (device lain menulis lebih tinggi — deduksi kita tertimpa / ada penambahan)
    (fetchInventoryFromCloud as any).mockResolvedValue([item('kopi', 'Kopi', 12)]);

    await useInventoryStore.getState().loadFromCloud(true);

    const s = useInventoryStore.getState();
    expect(s.items[0].stock).toBe(12);
    expect(s.stockConflicts).toHaveLength(1);
    expect(s.stockConflicts[0].ingredientId).toBe('kopi');
    expect(s.stockConflicts[0].localBefore).toBe(8);

    useInventoryStore.getState().clearStockConflicts();
    expect(useInventoryStore.getState().stockConflicts).toHaveLength(0);
  });

  it('sync normal (cloud lebih rendah / sama) tidak memunculkan konflik', async () => {
    useInventoryStore.setState({ items: [item('kopi', 'Kopi', 8)] });
    (fetchInventoryFromCloud as any).mockResolvedValue([item('kopi', 'Kopi', 5)]);
    await useInventoryStore.getState().loadFromCloud(true);
    expect(useInventoryStore.getState().stockConflicts).toHaveLength(0);
  });
});
