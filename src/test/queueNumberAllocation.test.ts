import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// TO DO 18.2 (Prioritas 18) — getNextQueueNumber:
// alokasi nomor antrean ATOMIK dari counter cloud (RPC allocate_queue_number)
// dengan FLOOR max(cloudMax, localMax); fallback lokal bila offline / RPC belum ada.
// ============================================================================

vi.mock('../lib/cloudSync', () => ({
  syncTransaction: vi.fn().mockResolvedValue(true),
  syncTransactionStatus: vi.fn().mockResolvedValue(true),
  syncTransactionTxStatus: vi.fn().mockResolvedValue(true),
  syncTransactionMeta: vi.fn().mockResolvedValue(true),
  deleteTransactionCloud: vi.fn().mockResolvedValue(true),
  fetchMaxQueueNumberCloud: vi.fn(),
  allocateQueueNumberCloud: vi.fn(),
  syncMenu: vi.fn().mockResolvedValue(true),
  deleteMenuCloud: vi.fn().mockResolvedValue(true),
  fetchMenusFromCloud: vi.fn().mockResolvedValue([]),
  syncCustomCategories: vi.fn().mockResolvedValue(true),
  fetchCustomCategoriesFromCloud: vi.fn().mockResolvedValue([]),
  syncInventoryItem: vi.fn().mockResolvedValue(true),
  syncInventoryStock: vi.fn().mockResolvedValue(true),
  adjustInventoryStockCloud: vi.fn().mockResolvedValue({ ok: [], conflicts: [], degraded: false }),
  deleteInventoryCloud: vi.fn().mockResolvedValue(true),
  fetchInventoryFromCloud: vi.fn().mockResolvedValue([]),
  syncStockLog: vi.fn().mockResolvedValue(true),
  syncStockLogsBulk: vi.fn().mockResolvedValue(true),
  syncAuditLog: vi.fn().mockResolvedValue(true),
  fetchAuditLogsFromCloud: vi.fn().mockResolvedValue([]),
}));

vi.mock('../utils/printer', () => ({
  printReceipt: vi.fn(),
  buildReceiptFromTransaction: vi.fn(),
}));

import { useTransactionStore } from '../store/transactionStore';
import { useMenuStore } from '../store/menuStore';
import { useInventoryStore } from '../store/inventoryStore';
import { fetchMaxQueueNumberCloud, allocateQueueNumberCloud } from '../lib/cloudSync';
import type { Transaction } from '../types';

function todayStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function tx(id: string, queueNumber: number): Transaction {
  return {
    id,
    queueNumber,
    date: new Date().toISOString(),
    txStatus: 'Selesai',
    isPending: false,
    items: [],
    subtotal: 0,
    discount: 0,
    tax: 0,
    totalAmount: 0,
    paymentMethod: 'Cash',
    kitchenStatus: 'Waiting',
    cashierId: 'u1',
    cashierName: 'Kasir 1',
    hpp: 0,
    cogs: 0,
    totalCogs: 0,
    grossProfit: 0,
    updatedAt: new Date().toISOString(),
  } as Transaction;
}

beforeEach(() => {
  vi.clearAllMocks();
  useTransactionStore.setState({
    transactions: [],
    nextQueueNumber: 1,
    lastQueueDate: null,
    deletedLocalIds: [],
    confirmedSyncIds: [],
  });
  useMenuStore.setState({ menus: [] });
  useInventoryStore.setState({ items: [] });
  (fetchMaxQueueNumberCloud as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  (allocateQueueNumberCloud as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe('getNextQueueNumber — alokasi RPC atomik (TO DO 18.2)', () => {
  it('ONLINE + RPC tersedia → mengembalikan nomor teralokasi counter cloud (bukan max+1 lokal)', async () => {
    (allocateQueueNumberCloud as ReturnType<typeof vi.fn>).mockResolvedValue(42);
    const num = await useTransactionStore.getState().getNextQueueNumber();
    expect(num).toBe(42);
    // floor dibangun dari cloudMax + localMax
    expect(fetchMaxQueueNumberCloud).toHaveBeenCalledWith(todayStr());
    expect(allocateQueueNumberCloud).toHaveBeenCalledWith(todayStr(), 0);
  });

  it('floor menghormati transaksi lokal yang sudah ada (tidak menabrak #7)', async () => {
    useTransactionStore.setState({ transactions: [tx('a', 7)] });
    (allocateQueueNumberCloud as ReturnType<typeof vi.fn>).mockResolvedValue(8);
    const num = await useTransactionStore.getState().getNextQueueNumber();
    expect(num).toBe(8);
    expect(allocateQueueNumberCloud).toHaveBeenCalledWith(todayStr(), 7);
  });

  it('floor = max(cloudMax, localMax) — cloudMax lebih tinggi dari lokal menang', async () => {
    useTransactionStore.setState({ transactions: [tx('a', 3)] });
    (fetchMaxQueueNumberCloud as ReturnType<typeof vi.fn>).mockResolvedValue(9);
    (allocateQueueNumberCloud as ReturnType<typeof vi.fn>).mockResolvedValue(10);
    const num = await useTransactionStore.getState().getNextQueueNumber();
    expect(num).toBe(10);
    expect(allocateQueueNumberCloud).toHaveBeenCalledWith(todayStr(), 9);
  });

  it('ONLINE tapi RPC belum ada (null) → fallback max+1 (perilaku lama, masih aman)', async () => {
    useTransactionStore.setState({ transactions: [tx('a', 5)] });
    (fetchMaxQueueNumberCloud as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    // allocateQueueNumberCloud → null (fungsi belum dibuat di DB / offline)
    const num = await useTransactionStore.getState().getNextQueueNumber();
    expect(num).toBe(6); // max(5 cloud, 5 lokal) + 1
  });

  it('OFFLINE (fetchMax 0 + allocate null) → fallback localMax + 1', async () => {
    useTransactionStore.setState({ transactions: [tx('a', 7), tx('b', 4)] });
    const num = await useTransactionStore.getState().getNextQueueNumber();
    expect(num).toBe(8);
  });

  it('tanpa transaksi sama sekali → nomor 1', async () => {
    const num = await useTransactionStore.getState().getNextQueueNumber();
    expect(num).toBe(1);
  });
});
