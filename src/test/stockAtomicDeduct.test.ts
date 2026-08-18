import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// TO DO 18.1 (Prioritas 18) — Unit: adjustInventoryStockCloud (cloudSync)
// Sync stok cloud berbasis DELTA ATOMIK via RPC `adjust_inventory_stock`:
//   - deduksi (delta < 0) DITOLAK cloud bila stok cloud < jumlah → cegah lost-update 2 kasir
//   - revert (delta > 0) selalu diizinkan
//   - offline / RPC belum dibuat di DB → fallback ABSOLUT (perilaku lama) + degraded
// ============================================================================

const mocks = vi.hoisted(() => ({
  configured: { value: true },
  rpc: vi.fn(),
  smartUpdate: vi.fn(),
  smartUpsert: vi.fn(),
  smartDelete: vi.fn(),
  smartInsert: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  get isSupabaseConfigured() {
    return mocks.configured.value;
  },
  supabase: { rpc: mocks.rpc },
}));

vi.mock('../lib/offlineQueue', () => ({
  smartUpdate: mocks.smartUpdate,
  smartUpsert: mocks.smartUpsert,
  smartDelete: mocks.smartDelete,
  smartInsert: mocks.smartInsert,
}));

import { adjustInventoryStockCloud } from '../lib/cloudSync';
import type { InventoryItem } from '../types';

function item(id: string, stock: number): InventoryItem {
  return { id, name: `Bahan ${id}`, stock, unit: 'kg', costPerUnit: 1000 } as InventoryItem;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockReset();
  mocks.smartUpdate.mockReset();
  mocks.configured.value = true;
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('adjustInventoryStockCloud — RPC atomik (TO DO 18.1)', () => {
  it('SKENARIO 2 KASIR: kasir B ditolak saat stok cloud tersisa < jumlah → konflik + stok aktual', async () => {
    // Kasir A memotong 3 dari stok 5 (cloud 5→2, ok). Kasir B memotong 3 dari baseline 5:
    // cloud sudah 2 < 3 → RPC menolak (reason insufficient) dengan stok aktual 2.
    mocks.rpc
      .mockResolvedValueOnce({ data: { ok: true, stock: 2, reason: 'ok' }, error: null })
      .mockResolvedValueOnce({ data: { ok: false, stock: 2, reason: 'insufficient' }, error: null });

    const res = await adjustInventoryStockCloud(
      [
        { id: 'kopi', delta: -3 },
        { id: 'kopi2', delta: -3 },
      ],
      [item('kopi', 2), item('kopi2', 2)]
    );

    expect(res.ok).toEqual([{ id: 'kopi', delta: -3 }]);
    expect(res.conflicts).toEqual([{ id: 'kopi2', delta: -3, cloudStock: 2 }]);
    expect(res.degraded).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith('adjust_inventory_stock', { p_id: 'kopi', p_delta: -3 });
    // Jalur atomik TIDAK menulis nilai absolut (tidak ada smartUpdate)
    expect(mocks.smartUpdate).not.toHaveBeenCalled();
  });

  it('delta POSITIF (revert) selalu diizinkan — tidak pernah konflik', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, stock: 10, reason: 'ok' }, error: null });
    const res = await adjustInventoryStockCloud([{ id: 'kopi', delta: 4 }], [item('kopi', 10)]);
    expect(res.conflicts).toHaveLength(0);
    expect(res.ok).toEqual([{ id: 'kopi', delta: 4 }]);
    expect(mocks.rpc).toHaveBeenCalledWith('adjust_inventory_stock', { p_id: 'kopi', p_delta: 4 });
  });

  it('RPC belum dibuat di DB (PGRST202) → fallback ABSOLUT per id + degraded', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Could not find the function public.adjust_inventory_stock' },
    });
    const res = await adjustInventoryStockCloud([{ id: 'kopi', delta: -3 }], [item('kopi', 2)]);
    expect(res.degraded).toBe(true);
    expect(res.ok).toEqual([{ id: 'kopi', delta: -3 }]);
    // Fallback memakai nilai stok pasca-mutasi lokal (perilaku lama, aman bila DB belum di-upgrade)
    // v4.7 TO DO 18.8 (A5): payload kini menyertakan updated_at (last-write-wins)
    expect(mocks.smartUpdate).toHaveBeenCalledWith(
      'inventory',
      expect.objectContaining({ stock: 2, updated_at: expect.any(String) }),
      'id',
      'kopi'
    );
  });

  it('OFFLINE → fallback ABSOLUT (masuk offline queue via smartUpdate) + degraded, tanpa RPC', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const res = await adjustInventoryStockCloud([{ id: 'kopi', delta: -3 }], [item('kopi', 2)]);
    expect(res.degraded).toBe(true);
    expect(mocks.smartUpdate).toHaveBeenCalledWith(
      'inventory',
      expect.objectContaining({ stock: 2, updated_at: expect.any(String) }),
      'id',
      'kopi'
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('TANPA konfigurasi Supabase → semua dianggap ok, tanpa RPC/smartUpdate (local-first)', async () => {
    mocks.configured.value = false;
    const res = await adjustInventoryStockCloud([{ id: 'kopi', delta: -3 }], [item('kopi', 2)]);
    expect(res.ok).toEqual([{ id: 'kopi', delta: -3 }]);
    expect(res.conflicts).toHaveLength(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.smartUpdate).not.toHaveBeenCalled();
  });

  it('id tidak ditemukan di cloud (not_found) → dianggap ok (bahan baru lokal belum di-upsert)', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, stock: null, reason: 'not_found' }, error: null });
    const res = await adjustInventoryStockCloud([{ id: 'baru', delta: -1 }], [item('baru', 5)]);
    expect(res.conflicts).toHaveLength(0);
    expect(res.ok).toEqual([{ id: 'baru', delta: -1 }]);
  });

  it('campuran: 1 ok + 1 ditolak + 1 RPC error → konflik & fallback terpisah dengan benar', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { ok: true, stock: 4, reason: 'ok' }, error: null })
      .mockResolvedValueOnce({ data: { ok: false, stock: 1, reason: 'insufficient' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'PGRST202 function not found' } });

    const res = await adjustInventoryStockCloud(
      [
        { id: 'a', delta: -1 },
        { id: 'b', delta: -2 },
        { id: 'c', delta: -3 },
      ],
      [item('a', 4), item('b', 1), item('c', 9)]
    );

    expect(res.ok.map((x) => x.id)).toEqual(['a', 'c']); // c lewat fallback absolut
    expect(res.conflicts).toEqual([{ id: 'b', delta: -2, cloudStock: 1 }]);
    expect(res.degraded).toBe(true);
    // Hanya id yang RPC-nya error yang di-fallback (b tidak double-processed)
    expect(mocks.smartUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.smartUpdate).toHaveBeenCalledWith(
      'inventory',
      expect.objectContaining({ stock: 9, updated_at: expect.any(String) }),
      'id',
      'c'
    );
  });
});
