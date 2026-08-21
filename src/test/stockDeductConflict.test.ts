import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// TO DO 18.1 (Prioritas 18) — Integrasi: inventoryStore.deductStock menangani
// konflik RPC (oversell lintas device) → koreksi stok lokal ke nilai cloud,
// jejak stock log 'adjust', dan toast warning.
// ============================================================================

vi.mock('../lib/cloudSync', () => ({
  syncInventoryItem: vi.fn(),
  syncInventoryStock: vi.fn(),
  adjustInventoryStockCloud: vi.fn(),
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
import { useToastStore } from '../store/toastStore';
import { adjustInventoryStockCloud } from '../lib/cloudSync';
import type { InventoryItem } from '../types';

function makeItem(id: string, stock: number, name = `Bahan ${id}`): InventoryItem {
  return { id, name, stock, unit: 'kg', costPerUnit: 1000, minStock: 5 } as InventoryItem;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  useInventoryStore.setState({ items: [], lastNegativeStockAlerts: [], stockConflicts: [] });
  useStockLogStore.setState({ logs: [] });
  useToastStore.setState({ toasts: [] });
});

describe('deductStock — konflik deduksi cloud (TO DO 18.1)', () => {
  it('RPC menolak deduksi (stok sudah terjual device lain) → stok lokal dikoreksi ke nilai cloud + log adjust + toast', async () => {
    useInventoryStore.setState({ items: [makeItem('kopi', 5, 'Kopi')] });
    // Cloud: kasir lain sudah menjual 4 dari 5 → stok cloud 1. Kasir ini memotong 3 dari
    // baseline 5 → lokal 2, tapi RPC menolak (cloud 1 < 3) dengan stok aktual 1.
    (adjustInventoryStockCloud as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: [],
      conflicts: [{ id: 'kopi', delta: -3, cloudStock: 1 }],
      degraded: false,
    });

    useInventoryStore.getState().deductStock({ kopi: 3 }, 'Transaksi #1');
    await tick();

    // Stok lokal dikoreksi ke nilai cloud (sumber kebenaran lintas device)
    expect(useInventoryStore.getState().items.find((i) => i.id === 'kopi')?.stock).toBe(1);

    // Jejak audit: log tipe 'adjust' dengan amount negatif (koreksi turun)
    const log = useStockLogStore.getState().logs.find((l) => l.inventoryId === 'kopi');
    expect(log).toBeDefined();
    expect(log!.type).toBe('adjust');
    expect(log!.stockBefore).toBe(2);
    expect(log!.stockAfter).toBe(1);
    expect(log!.amount).toBe(-1);
    expect(log!.reason).toContain('Konflik lintas device');

    // Toast warning muncul
    const toast = useToastStore.getState().toasts.find((t) => t.message.includes('Kopi'));
    expect(toast).toBeDefined();
    expect(toast!.type).toBe('warning');
  });

  it('konflik normal 2 kasir baseline sama (lokal 2 == cloud 2) → koreksi no-op, tetap ada log & toast', async () => {
    useInventoryStore.setState({ items: [makeItem('kopi', 5, 'Kopi')] });
    (adjustInventoryStockCloud as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: [],
      conflicts: [{ id: 'kopi', delta: -3, cloudStock: 2 }],
      degraded: false,
    });

    useInventoryStore.getState().deductStock({ kopi: 3 }, 'Transaksi #1');
    await tick();

    expect(useInventoryStore.getState().items.find((i) => i.id === 'kopi')?.stock).toBe(2);
    // 1 log 'deduct' (normal) + 1 log 'adjust' (koreksi konflik)
    expect(useStockLogStore.getState().logs.filter((l) => l.type === 'adjust')).toHaveLength(1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('TANPA konflik (normal) → stok lokal tidak disentuh ulang, tidak ada log adjust', async () => {
    useInventoryStore.setState({ items: [makeItem('kopi', 5, 'Kopi')] });
    (adjustInventoryStockCloud as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: [{ id: 'kopi', delta: -3 }],
      conflicts: [],
      degraded: false,
    });

    useInventoryStore.getState().deductStock({ kopi: 3 }, 'Transaksi #1');
    await tick();

    expect(useInventoryStore.getState().items.find((i) => i.id === 'kopi')?.stock).toBe(2);
    expect(useStockLogStore.getState().logs.filter((l) => l.type === 'adjust')).toHaveLength(0);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('banyak konflik sekaligus → semua dikoreksi, toast dirangkum', async () => {
    useInventoryStore.setState({
      items: [makeItem('kopi', 5, 'Kopi'), makeItem('susu', 8, 'Susu'), makeItem('gula', 10, 'Gula')],
    });
    (adjustInventoryStockCloud as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: [],
      conflicts: [
        { id: 'kopi', delta: -3, cloudStock: 1 },
        { id: 'susu', delta: -2, cloudStock: 4 },
        { id: 'gula', delta: -1, cloudStock: 6 },
      ],
      degraded: false,
    });

    useInventoryStore.getState().deductStock({ kopi: 3, susu: 2, gula: 1 }, 'Transaksi #1');
    await tick();

    const s = useInventoryStore.getState();
    expect(s.items.find((i) => i.id === 'kopi')?.stock).toBe(1);
    expect(s.items.find((i) => i.id === 'susu')?.stock).toBe(4);
    expect(s.items.find((i) => i.id === 'gula')?.stock).toBe(6);
    expect(useStockLogStore.getState().logs.filter((l) => l.type === 'adjust')).toHaveLength(3);
    // Toast merangkum: 2 nama + "+1 bahan lain"
    const toast = useToastStore.getState().toasts[0];
    expect(toast).toBeDefined();
    expect(toast.message).toContain('+1 bahan lain');
  });
});

describe('revertStock — delta positif (TO DO 18.1)', () => {
  it('revert mengirim delta POSITIF ke adjustInventoryStockCloud (tidak pernah konflik)', async () => {
    useInventoryStore.setState({ items: [makeItem('kopi', 2, 'Kopi')] });
    (adjustInventoryStockCloud as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: [{ id: 'kopi', delta: 3 }],
      conflicts: [],
      degraded: false,
    });

    useInventoryStore.getState().revertStock({ kopi: 3 }, 'Revert: Cancel transaksi #1');
    await tick();

    expect(adjustInventoryStockCloud).toHaveBeenCalledWith(
      [{ id: 'kopi', delta: 3 }],
      expect.any(Array)
    );
    expect(useInventoryStore.getState().items.find((i) => i.id === 'kopi')?.stock).toBe(5);
  });
});
