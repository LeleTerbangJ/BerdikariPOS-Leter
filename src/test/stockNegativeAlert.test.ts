import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cloudSync — verifikasi jalur sync stok tanpa network.
// Sertakan export yang dipakai store lain (stockLogStore/menuStore/auditLogStore) sebagai no-op.
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

import { findNegativeStocksAfterDeduction } from '../utils/stockCheck';
import { useInventoryStore } from '../store/inventoryStore';
import { adjustInventoryStockCloud, syncInventoryStock, syncInventoryItem } from '../lib/cloudSync';
import type { InventoryItem } from '../types';

// toastStore memakai window.setTimeout (auto-hilang) — stub untuk environment node.
(globalThis as any).window = { setTimeout: (fn: () => void) => setTimeout(fn) };

function makeItem(id: string, stock: number, name = `Bahan ${id}`, unit = 'kg'): InventoryItem {
  return { id, name, stock, unit, costPerUnit: 1000, minStock: 5 } as InventoryItem;
}

beforeEach(() => {
  vi.clearAllMocks();
  useInventoryStore.setState({ items: [], lastNegativeStockAlerts: [] });
});

// ============================================================
// TO DO 8.4 — findNegativeStocksAfterDeduction (helper murni)
// ============================================================

describe('findNegativeStocksAfterDeduction (TO DO 8.4 — pantau stok negatif)', () => {
  it('deduksi melebihi stok → alert negatif dengan stok pasca-deduksi', () => {
    const items = [makeItem('invA', 5)];
    const alerts = findNegativeStocksAfterDeduction(items, { invA: 6 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toEqual({ inventoryId: 'invA', name: 'Bahan invA', stock: -1, unit: 'kg' });
  });

  it('deduksi tepat habis (stok 5 - 5 = 0) → BUKAN negatif, tidak ada alert', () => {
    const alerts = findNegativeStocksAfterDeduction([makeItem('invA', 5)], { invA: 5 });
    expect(alerts).toHaveLength(0);
  });

  it('beberapa item: hanya yang jadi negatif yang dilaporkan', () => {
    const items = [makeItem('invA', 2), makeItem('invB', 50), makeItem('invC', 3)];
    const alerts = findNegativeStocksAfterDeduction(items, { invA: 10, invB: 10, invC: 4 });
    expect(alerts.map((a) => a.inventoryId)).toEqual(['invA', 'invC']);
    expect(alerts.find((a) => a.inventoryId === 'invB')).toBeUndefined();
  });

  it('amount 0 / item tidak ditemukan / id tak dikenal → dilewati (tidak crash)', () => {
    const items = [makeItem('invA', 5)];
    expect(findNegativeStocksAfterDeduction(items, { invA: 0 })).toHaveLength(0);
    expect(findNegativeStocksAfterDeduction(items, { invZZ: 99 })).toHaveLength(0);
    expect(findNegativeStocksAfterDeduction([], { invA: 5 })).toHaveLength(0);
  });
});

// ============================================================
// Integrasi store: deductStock & revertStock
// ============================================================

describe('deductStock — warning stok negatif pasca-deduksi (TO DO 8.4)', () => {
  it('stok jadi negatif → lastNegativeStockAlerts terisi + toast warning', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 2, 'Beras')] });
    useInventoryStore.getState().deductStock({ invA: 5 }, 'Transaksi #1');

    const s = useInventoryStore.getState();
    expect(s.items.find((i) => i.id === 'invA')?.stock).toBe(-3);
    expect(s.lastNegativeStockAlerts).toHaveLength(1);
    expect(s.lastNegativeStockAlerts[0]).toMatchObject({ inventoryId: 'invA', name: 'Beras', stock: -3 });
  });

  it('stok tetap non-negatif → tidak ada alert', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 10)] });
    useInventoryStore.getState().deductStock({ invA: 5 }, 'Transaksi #1');
    expect(useInventoryStore.getState().lastNegativeStockAlerts).toHaveLength(0);
  });
});

describe('Jalur sync stok cloud ATOMIK (TO DO 8.3 + 18.1)', () => {
  it('deductStock: adjustInventoryStockCloud dipanggil SEKALI dengan DELTA negatif + stok pasca-deduksi', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 10), makeItem('invB', 20)] });
    useInventoryStore.getState().deductStock({ invA: 4, invB: 6 }, 'Transaksi #1');

    expect(adjustInventoryStockCloud).toHaveBeenCalledTimes(1);
    const [adjustments, items] = (adjustInventoryStockCloud as ReturnType<typeof vi.fn>).mock.calls[0];
    // Delta NEGATIF (deduksi) — RPC atomik `stock = stock + delta` dengan guard stok
    expect(adjustments).toEqual([
      { id: 'invA', delta: -4 },
      { id: 'invB', delta: -6 },
    ]);
    // Items yang dikirim sudah memuat nilai stok post-deduksi (fallback absolut bila RPC gagal)
    expect(items.find((i: InventoryItem) => i.id === 'invA').stock).toBe(6);
    expect(items.find((i: InventoryItem) => i.id === 'invB').stock).toBe(14);
    // syncInventoryItem tidak dipakai untuk deduct (unifikasi bulk)
    expect(syncInventoryItem).not.toHaveBeenCalled();
  });

  it('revertStock: adjustInventoryStockCloud dipanggil SEKALI dengan DELTA positif', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 6)] });
    useInventoryStore.getState().revertStock({ invA: 4 }, 'Revert: Cancel transaksi #1');

    expect(adjustInventoryStockCloud).toHaveBeenCalledTimes(1);
    const [adjustments, items] = (adjustInventoryStockCloud as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(adjustments).toEqual([{ id: 'invA', delta: 4 }]); // delta POSITIF (revert)
    expect(items.find((i: InventoryItem) => i.id === 'invA').stock).toBe(10); // 6 + 4
    expect(syncInventoryItem).not.toHaveBeenCalled();
  });

  it('revertStock membersihkan lastNegativeStockAlerts (revert bisa memperbaiki negatif)', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 2)] });
    useInventoryStore.getState().deductStock({ invA: 5 }, 'Transaksi #1');
    expect(useInventoryStore.getState().lastNegativeStockAlerts).toHaveLength(1);

    useInventoryStore.getState().revertStock({ invA: 5 }, 'Revert: Cancel transaksi #1');
    expect(useInventoryStore.getState().items.find((i) => i.id === 'invA')?.stock).toBe(2);
    expect(useInventoryStore.getState().lastNegativeStockAlerts).toHaveLength(0);
  });

  // v4.7 TO DO 18.8 (A12) — revert APA PUN tidak lagi menghapus peringatan yang masih relevan
  it('revert item LAIN (tidak memperbaiki negatif) → alert stok negatif PERTAHAN', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 2), makeItem('invB', 10)] });
    useInventoryStore.getState().deductStock({ invA: 5 }, 'Transaksi #1');
    expect(useInventoryStore.getState().lastNegativeStockAlerts).toHaveLength(1);

    // Revert hanya invB (stok positif) — invA masih negatif, peringatan TIDAK boleh hilang
    useInventoryStore.getState().revertStock({ invB: 3 }, 'Koreksi Pending');
    const alerts = useInventoryStore.getState().lastNegativeStockAlerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ inventoryId: 'invA', stock: -3 });
  });

  it('revert SEBAGIAN memperbaiki negatif → alert tetap ada dengan stok terbaru', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 2)] });
    useInventoryStore.getState().deductStock({ invA: 5 }, 'Transaksi #1'); // stok -3
    expect(useInventoryStore.getState().lastNegativeStockAlerts).toHaveLength(1);

    useInventoryStore.getState().revertStock({ invA: 2 }, 'Koreksi Pending'); // stok -1
    const alerts = useInventoryStore.getState().lastNegativeStockAlerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ inventoryId: 'invA', stock: -1 });
  });

  it('revert MENYELURUH memperbaiki negatif → alert bersih', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 2)] });
    useInventoryStore.getState().deductStock({ invA: 5 }, 'Transaksi #1'); // stok -3
    useInventoryStore.getState().revertStock({ invA: 3 }, 'Cancel transaksi #1'); // stok 2
    expect(useInventoryStore.getState().lastNegativeStockAlerts).toHaveLength(0);
  });
});
