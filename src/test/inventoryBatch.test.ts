import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cloudSync — verifikasi jalur sync tanpa network (pola sama dengan stockNegativeAlert.test).
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

// toastStore memakai window.setTimeout — stub untuk environment node.
(globalThis as any).window = { setTimeout: (fn: () => void) => setTimeout(fn) };

import { useInventoryStore } from '../store/inventoryStore';
import { useStockLogStore } from '../store/stockLogStore';
import { syncInventoryStock, syncInventoryItem } from '../lib/cloudSync';
import type { InventoryItem } from '../types';

function makeItem(id: string, stock: number, name = `Bahan ${id}`, unit = 'kg'): InventoryItem {
  return { id, name, stock, unit, costPerUnit: 1000, minStock: 5 } as InventoryItem;
}

beforeEach(() => {
  vi.clearAllMocks();
  useInventoryStore.setState({ items: [], lastNegativeStockAlerts: [] });
  useStockLogStore.setState({ logs: [] });
});

// ============================================================
// TO DO 9.3 — auto-log memakai nama BARU saat rename bersamaan
// ============================================================

describe('updateItem — nama baru di stock log saat rename bersamaan (TO DO 9.3)', () => {
  it('rename + ubah stok sekaligus → log memakai nama baru (bukan nama lama)', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 10, 'Beras Lama')] });
    useInventoryStore.getState().updateItem('invA', { name: 'Beras Premium', stock: 5 });

    const log = useStockLogStore.getState().logs.find((l) => l.inventoryId === 'invA');
    expect(log).toBeDefined();
    expect(log!.type).toBe('adjust');
    expect(log!.inventoryName).toBe('Beras Premium'); // nama baru
    expect(log!.stockBefore).toBe(10);
    expect(log!.stockAfter).toBe(5);
  });

  it('ubah stok TANPA rename → nama lama tetap dipakai (fallback)', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 10, 'Beras')] });
    useInventoryStore.getState().updateItem('invA', { stock: 5 });

    const log = useStockLogStore.getState().logs.find((l) => l.inventoryId === 'invA');
    expect(log!.inventoryName).toBe('Beras');
  });
});

// ============================================================
// TO DO 9.4 — batch sync: applyBulkStock & importItems
// ============================================================

describe('applyBulkStock (TO DO 9.4 — opname batch)', () => {
  it('SATU setState + SATU syncInventoryStock bulk (bukan N × syncInventoryItem)', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 10), makeItem('invB', 20)] });
    useInventoryStore.getState().applyBulkStock([
      { id: 'invA', stock: 3 },
      { id: 'invB', stock: 7 },
    ]);

    const s = useInventoryStore.getState();
    expect(s.items.find((i) => i.id === 'invA')?.stock).toBe(3);
    expect(s.items.find((i) => i.id === 'invB')?.stock).toBe(7);

    expect(syncInventoryStock).toHaveBeenCalledTimes(1);
    const [ids, items] = (syncInventoryStock as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(Object.keys(ids)).toEqual(['invA', 'invB']);
    expect(items.find((i: InventoryItem) => i.id === 'invA').stock).toBe(3);
    expect(syncInventoryItem).not.toHaveBeenCalled();
  });

  it('entries kosong → tidak melakukan apa-apa', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 10)] });
    useInventoryStore.getState().applyBulkStock([]);
    expect(syncInventoryStock).not.toHaveBeenCalled();
  });
});

describe('importItems (TO DO 9.4 — CSV import batch)', () => {
  it('1 setState untuk semua baris + log "import" + sync bulk; upsert penuh hanya item baru', () => {
    useInventoryStore.setState({
      items: [makeItem('invA', 10, 'Beras Lama')],
    });

    useInventoryStore.getState().importItems([
      // invA: HANYA stok yang berubah (field lain sama) → cukup jalur bulk, tanpa upsert penuh
      { id: 'invA', name: 'Beras Lama', stock: 15, unit: 'kg', costPerUnit: 1000, minStock: 5 },
      // invB: item BARU → perlu upsert penuh
      { id: 'invB', name: 'Gula', stock: 8, unit: 'kg', costPerUnit: 7000, minStock: 2 },
    ]);

    const s = useInventoryStore.getState();
    // Semua perubahan stok terjadi sekaligus
    expect(s.items.find((i) => i.id === 'invA')?.stock).toBe(15);
    expect(s.items.find((i) => i.id === 'invB')?.stock).toBe(8);

    // Log 'import' untuk BOTH (existing berubah & item baru)
    const logs = useStockLogStore.getState().logs;
    expect(logs.filter((l) => l.type === 'import')).toHaveLength(2);
    expect(logs.find((l) => l.inventoryId === 'invA')?.reason).toBe('Import CSV');
    expect(logs.find((l) => l.inventoryId === 'invB')?.stockBefore).toBe(0);

    // Sync: SATU bulk stok (kedua id) + SATU upsert penuh (hanya item baru)
    expect(syncInventoryStock).toHaveBeenCalledTimes(1);
    const [ids] = (syncInventoryStock as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(Object.keys(ids).sort()).toEqual(['invA', 'invB']);
    expect(syncInventoryItem).toHaveBeenCalledTimes(1);
    expect((syncInventoryItem as ReturnType<typeof vi.fn>).mock.calls[0][0].id).toBe('invB');
  });

  it('existing dengan stok SAMA + tanpa field berubah → tanpa log & tanpa sync penuh', () => {
    useInventoryStore.setState({ items: [makeItem('invA', 10, 'Beras')] });
    useInventoryStore.getState().importItems([
      { id: 'invA', name: 'Beras', stock: 10, unit: 'kg', costPerUnit: 1000, minStock: 5 },
    ]);

    expect(useStockLogStore.getState().logs).toHaveLength(0);
    // stok tetap disync via bulk (id ada di stockIds) — tetapi tidak ada upsert penuh
    expect(syncInventoryStock).toHaveBeenCalledTimes(1);
    expect(syncInventoryItem).not.toHaveBeenCalled();
  });

  it('rows kosong → tidak melakukan apa-apa', () => {
    useInventoryStore.getState().importItems([]);
    expect(syncInventoryStock).not.toHaveBeenCalled();
    expect(syncInventoryItem).not.toHaveBeenCalled();
  });
});
