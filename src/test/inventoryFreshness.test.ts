import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// v4.7 TO DO 18.8 (A5) — Race sync stok burst multi-device:
// last-write-wins via updatedAt — fetch cloud STALE tidak boleh menimpa mutasi
// lokal yang lebih baru (dan sebaliknya, cloud yang lebih baru diadopsi).
// ============================================================================

vi.mock('../lib/cloudSync', () => ({
  syncInventoryItem: vi.fn(),
  syncInventoryStock: vi.fn(),
  adjustInventoryStockCloud: vi.fn().mockResolvedValue({ ok: [], conflicts: [], degraded: false }),
  fetchMaxQueueNumberCloud: vi.fn().mockResolvedValue(0),
  allocateQueueNumberCloud: vi.fn().mockResolvedValue(null),
  deleteInventoryCloud: vi.fn(),
  fetchInventoryFromCloud: vi.fn().mockResolvedValue([]),
  syncStockLog: vi.fn(),
  syncStockLogsBulk: vi.fn(),
  fetchStockLogsFromCloud: vi.fn().mockResolvedValue([]),
  syncMenu: vi.fn(),
  deleteMenuCloud: vi.fn(),
  fetchMenusFromCloud: vi.fn().mockResolvedValue([]),
  syncCustomCategories: vi.fn(),
  fetchCustomCategoriesFromCloud: vi.fn().mockResolvedValue([]),
  syncTransaction: vi.fn(),
  syncTransactionStatus: vi.fn(),
  syncTransactionTxStatus: vi.fn(),
  deleteTransactionCloud: vi.fn(),
  syncAuditLog: vi.fn(),
  fetchAuditLogsFromCloud: vi.fn().mockResolvedValue([]),
}));

(globalThis as any).window = { setTimeout: (fn: () => void) => setTimeout(fn) };

import { useInventoryStore } from '../store/inventoryStore';
import { useStockLogStore } from '../store/stockLogStore';
import { fetchInventoryFromCloud, syncInventoryStock } from '../lib/cloudSync';
import { isLocalNewer } from '../utils/inventoryFreshness';
import type { InventoryItem } from '../types';

const mockedFetch = vi.mocked(fetchInventoryFromCloud);
const mockedSyncStock = vi.mocked(syncInventoryStock);

function makeItem(id: string, stock: number, updatedAt?: string): InventoryItem {
  return { id, name: `Bahan ${id}`, stock, unit: 'kg', costPerUnit: 1000, minStock: 5, updatedAt } as InventoryItem;
}

beforeEach(() => {
  vi.clearAllMocks();
  useInventoryStore.setState({ items: [], lastNegativeStockAlerts: [], stockConflicts: [] });
  useStockLogStore.setState({ logs: [] });
  mockedFetch.mockResolvedValue([]);
});

describe('isLocalNewer — v4.7 TO DO 18.8 (A5)', () => {
  it('lokal lebih baru dari cloud → true (lokal dipertahankan)', () => {
    expect(isLocalNewer(makeItem('a', 5, '2026-08-18T10:00:00.000Z'), makeItem('a', 8, '2026-08-18T09:00:00.000Z'))).toBe(true);
  });

  it('cloud lebih baru → false (cloud diadopsi)', () => {
    expect(isLocalNewer(makeItem('a', 5, '2026-08-18T09:00:00.000Z'), makeItem('a', 8, '2026-08-18T10:00:00.000Z'))).toBe(false);
  });

  it('cloud tidak ada → true (item lokal tidak boleh dianggap stale)', () => {
    expect(isLocalNewer(makeItem('a', 5), undefined)).toBe(true);
    expect(isLocalNewer(makeItem('a', 5), null)).toBe(true);
  });

  it('local tidak ada (item murni cloud) → false (cloud menang)', () => {
    expect(isLocalNewer(undefined, makeItem('a', 8, '2026-08-18T10:00:00.000Z'))).toBe(false);
    expect(isLocalNewer(null, makeItem('a', 8))).toBe(false);
  });

  it('hanya lokal yang punya updatedAt (cloud legacy) → lokal menang', () => {
    expect(isLocalNewer(makeItem('a', 5, '2026-08-18T10:00:00.000Z'), makeItem('a', 8))).toBe(true);
  });

  it('hanya cloud yang punya updatedAt → cloud menang', () => {
    expect(isLocalNewer(makeItem('a', 5), makeItem('a', 8, '2026-08-18T10:00:00.000Z'))).toBe(false);
  });

  it('keduanya tanpa updatedAt (legacy murni) → false (cloud otoritatif, perilaku lama)', () => {
    expect(isLocalNewer(makeItem('a', 5), makeItem('a', 8))).toBe(false);
  });
});

describe('loadFromCloud — last-write-wins (A5)', () => {
  it('mutasi lokal lebih baru dari cloud stale → LOKAL dipertahankan (tidak ditimpa)', async () => {
    // Local: stock 2 hasil mutasi yang BELUM tersinkron (updatedAt lebih baru)
    const localNewer = makeItem('kopi', 2, '2026-08-18T11:00:00.000Z');
    useInventoryStore.setState({ items: [localNewer] });
    // Cloud masih punya nilai STALE (stock 8, updatedAt lama)
    mockedFetch.mockResolvedValue([makeItem('kopi', 8, '2026-08-18T08:00:00.000Z')]);

    await useInventoryStore.getState().loadFromCloud(true);

    const kept = useInventoryStore.getState().items.find((i) => i.id === 'kopi');
    expect(kept?.stock).toBe(2); // mutasi lokal yang lebih baru TIDAK ditimpa cloud stale
    // TIDAK ada duplikat (versi cloud stale tidak ikut di-merge)
    expect(useInventoryStore.getState().items.filter((i) => i.id === 'kopi')).toHaveLength(1);
  });

  it('cloud lebih baru → cloud diadopsi (mutasi lokal lama menyerah)', async () => {
    useInventoryStore.setState({ items: [makeItem('kopi', 2, '2026-08-18T08:00:00.000Z')] });
    mockedFetch.mockResolvedValue([makeItem('kopi', 8, '2026-08-18T11:00:00.000Z')]);

    await useInventoryStore.getState().loadFromCloud(true);

    const kept = useInventoryStore.getState().items.find((i) => i.id === 'kopi');
    expect(kept?.stock).toBe(8);
  });

  it('item legacy tanpa updatedAt + cloud punya updatedAt → cloud menang', async () => {
    useInventoryStore.setState({ items: [makeItem('kopi', 2)] }); // lokal legacy
    mockedFetch.mockResolvedValue([makeItem('kopi', 7, '2026-08-18T11:00:00.000Z')]);

    await useInventoryStore.getState().loadFromCloud(true);

    const kept = useInventoryStore.getState().items.find((i) => i.id === 'kopi');
    expect(kept?.stock).toBe(7);
  });

  it('fullSync: item lokal-only (tidak ada di cloud) di-drop — cloud otoritatif (perilaku lama)', async () => {
    useInventoryStore.setState({ items: [makeItem('lokal-saja', 3, '2026-08-18T11:00:00.000Z')] });
    mockedFetch.mockResolvedValue([makeItem('cloud-1', 5, '2026-08-18T09:00:00.000Z')]);

    await useInventoryStore.getState().loadFromCloud(true);

    const items = useInventoryStore.getState().items;
    expect(items.some((i) => i.id === 'lokal-saja')).toBe(false); // cloud otoritatif
    expect(items.some((i) => i.id === 'cloud-1')).toBe(true);
  });

  it('non-fullSync (realtime): item lokal-only tetap dipertahankan', async () => {
    useInventoryStore.setState({ items: [makeItem('lokal-saja', 3, '2026-08-18T11:00:00.000Z')] });
    mockedFetch.mockResolvedValue([makeItem('cloud-1', 5, '2026-08-18T09:00:00.000Z')]);

    await useInventoryStore.getState().loadFromCloud(false);

    const items = useInventoryStore.getState().items;
    expect(items.some((i) => i.id === 'lokal-saja')).toBe(true);
    expect(items.some((i) => i.id === 'cloud-1')).toBe(true);
  });
});

describe('stamp updatedAt pada mutasi stok (A5)', () => {
  it('deductStock & revertStock men-stamp updatedAt pada item yang diubah', () => {
    useInventoryStore.setState({ items: [makeItem('kopi', 10)] });
    useInventoryStore.getState().deductStock({ kopi: 3 });
    let item = useInventoryStore.getState().items.find((i) => i.id === 'kopi')!;
    expect(item.stock).toBe(7);
    expect(item.updatedAt).toBeTruthy();
    const t1 = item.updatedAt!;

    useInventoryStore.getState().revertStock({ kopi: 2 });
    item = useInventoryStore.getState().items.find((i) => i.id === 'kopi')!;
    expect(item.stock).toBe(9);
    expect(item.updatedAt).toBeTruthy();
    // Mutasi baru → timestamp berubah (menjadi lebih baru)
    expect(item.updatedAt! >= t1).toBe(true);
  });

  it('updateItem men-stamp updatedAt', () => {
    useInventoryStore.setState({ items: [makeItem('kopi', 10)] });
    useInventoryStore.getState().updateItem('kopi', { stock: 6 });
    const item = useInventoryStore.getState().items.find((i) => i.id === 'kopi')!;
    expect(item.stock).toBe(6);
    expect(item.updatedAt).toBeTruthy();
  });

  it('syncInventoryStock menerima items yang sudah ber-updatedAt (payload ke cloud)', () => {
    useInventoryStore.setState({ items: [makeItem('kopi', 7, '2026-08-18T11:00:00.000Z')] });
    const items = useInventoryStore.getState().items;
    // Jalur applyBulkStock → syncInventoryStock(ids, updatedItems)
    useInventoryStore.getState().applyBulkStock([{ id: 'kopi', stock: 7 }]);
    expect(mockedSyncStock).toHaveBeenCalled();
    const args = mockedSyncStock.mock.calls[0];
    const passed = args[1].find((i: InventoryItem) => i.id === 'kopi');
    expect(passed?.updatedAt).toBeTruthy();
  });
});
