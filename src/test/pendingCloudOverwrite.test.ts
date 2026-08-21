import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/cloudSync', () => ({
  syncTransaction: vi.fn().mockResolvedValue(true),
  syncTransactionStatus: vi.fn().mockResolvedValue(true),
  syncTransactionTxStatus: vi.fn().mockResolvedValue(true),
  syncTransactionMeta: vi.fn().mockResolvedValue(true),
  deleteTransactionCloud: vi.fn().mockResolvedValue(true),
  syncMenu: vi.fn().mockResolvedValue(true),
  deleteMenuCloud: vi.fn().mockResolvedValue(true),
  fetchMenusFromCloud: vi.fn().mockResolvedValue([]),
  syncCustomCategories: vi.fn().mockResolvedValue(true),
  fetchCustomCategoriesFromCloud: vi.fn().mockResolvedValue([]),
  syncInventoryItem: vi.fn().mockResolvedValue(true),
  syncInventoryStock: vi.fn().mockResolvedValue(true),
  adjustInventoryStockCloud: vi.fn().mockResolvedValue({ ok: [], conflicts: [], degraded: false }),
  fetchMaxQueueNumberCloud: vi.fn().mockResolvedValue(0),
  allocateQueueNumberCloud: vi.fn().mockResolvedValue(null),
  deleteInventoryCloud: vi.fn().mockResolvedValue(true),
  fetchInventoryFromCloud: vi.fn().mockResolvedValue([]),
  syncStockLog: vi.fn().mockResolvedValue(true),
  syncStockLogsBulk: vi.fn().mockResolvedValue(true),
  syncAuditLog: vi.fn().mockResolvedValue(true),
  fetchAuditLogsFromCloud: vi.fn().mockResolvedValue([]),
}));

import type { Transaction, CartItem } from '../types';
import { useTransactionStore } from '../store/transactionStore';

function makeItem(menuId: string, qty: number): CartItem {
  return {
    lineId: `${menuId}-${qty}`,
    menuId,
    name: `Menu ${menuId}`,
    basePrice: 10000,
    quantity: qty,
    temperature: 'Dingin',
    sugar: 'Normal',
    addons: [],
    subtotal: 10000 * qty,
  };
}

function makeTx(id: string, date: string, items: CartItem[], status = 'Pending'): Transaction {
  return {
    id,
    queueNumber: 1,
    date,
    items,
    subtotal: items.reduce((a, i) => a + i.subtotal, 0),
    discount: 0,
    totalAmount: items.reduce((a, i) => a + i.subtotal, 0),
    paymentMethod: 'Cash',
    kitchenStatus: 'Waiting',
    txStatus: status,
    isPending: status === 'Pending',
    cashierId: 'u1',
    cashierName: 'Kasir',
  } as Transaction;
}

beforeEach(() => {
  vi.clearAllMocks();
  useTransactionStore.setState({ transactions: [], deletedLocalIds: [] });
});

// v4.7 FIX: loadFromCloud kini membandingkan freshness (date) per transaksi.
// Update pending dengan ID yang sama men-stamp date baru di engine → update lokal lebih baru
// dari versi cloud sebelum upsert async selesai. Sebelumnya cloud-authoritative tanpa
// perbandingan → fetch realtime/refresh dengan data cloud STALE menimpa item lokal yang benar.
describe('loadFromCloud — freshness per transaksi (bug item pending tidak ter-update)', () => {
  it('update pending lokal LEBIH BARU → tidak ditimpa data cloud stale (item tetap ter-update)', () => {
    // Lokal: pending sudah di-update (item baru m3, tanggal lebih baru)
    const localTx = makeTx('X', '2026-08-15T10:00:00.000Z', [makeItem('m1', 1), makeItem('m3', 1)]);
    useTransactionStore.setState({ transactions: [localTx] });

    // Cloud STALE: masih berisi item lama (upsert belum selesai / gagal → queue offline)
    const cloudTx = makeTx('X', '2026-08-15T09:00:00.000Z', [makeItem('m1', 1), makeItem('m2', 1)]);

    useTransactionStore.getState().loadFromCloud([cloudTx], true);

    const all = useTransactionStore.getState().transactions;
    // Item baru m3 dipertahankan — tidak di-revert ke item lama
    expect(all.find((t) => t.id === 'X')?.items.map((i) => i.menuId).sort()).toEqual(['m1', 'm3']);
    // Versi cloud yang kalah TIDAK boleh ikut merge (anti duplikat baris ber-ID sama)
    expect(all.filter((t) => t.id === 'X')).toHaveLength(1);
  });

  it('cloud LEBIH BARU → cloud menang (propagasi update lintas device)', () => {
    // Lokal: versi lama [A, B] (date 09:00)
    const localTx = makeTx('X', '2026-08-15T09:00:00.000Z', [makeItem('m1', 1), makeItem('m2', 1)]);
    useTransactionStore.setState({ transactions: [localTx] });

    // Cloud: device lain sudah meng-update [A, C] (date 10:00)
    const cloudTx = makeTx('X', '2026-08-15T10:00:00.000Z', [makeItem('m1', 1), makeItem('m3', 1)]);

    useTransactionStore.getState().loadFromCloud([cloudTx], true);

    const after = useTransactionStore.getState().transactions.find((t) => t.id === 'X');
    expect(after?.items.map((i) => i.menuId).sort()).toEqual(['m1', 'm3']);
  });

  it('date sama → cloud menang (hindari duplikat lokal yang tidak diperlukan)', () => {
    const localTx = makeTx('X', '2026-08-15T10:00:00.000Z', [makeItem('m1', 1), makeItem('m2', 1)]);
    useTransactionStore.setState({ transactions: [localTx] });
    const cloudTx = makeTx('X', '2026-08-15T10:00:00.000Z', [makeItem('m1', 1), makeItem('m3', 1)]);

    useTransactionStore.getState().loadFromCloud([cloudTx], true);

    const after = useTransactionStore.getState().transactions.find((t) => t.id === 'X');
    expect(after?.items.map((i) => i.menuId).sort()).toEqual(['m1', 'm3']);
  });

  // v4.7 (evaluasi updatedAt): jalur update yang TIDAK mengubah `date` (void/status) juga
  // harus terlindungi dari fetch cloud stale — diselesaikan dengan updatedAt (fallback date).
  // Timestamp relatif terhadap Date.now() agar deterministik (tidak bergantung jam mesin).
  it('void/status lokal (updatedAt) tidak ditimpa cloud stale — status Cancel tetap', () => {
    const now = Date.now();
    const localCommitAt = new Date(now - 60 * 60 * 1000).toISOString(); // commit 1 jam lalu

    // Pending dicommit (date bisnis = commit), cloud belum punya updatedAt
    const localTx = makeTx('X', localCommitAt, [makeItem('m1', 1)]);
    useTransactionStore.setState({ transactions: [localTx] });

    // Void di halaman Transaksi → updateTxStatus men-stamp updatedAt = sekarang
    useTransactionStore.getState().updateTxStatus('X', 'Cancel');
    const localAfterVoid = useTransactionStore.getState().transactions.find((t) => t.id === 'X');
    expect(localAfterVoid?.txStatus).toBe('Cancel');
    expect(localAfterVoid?.updatedAt).toBeDefined();

    // Cloud STALE: baris commit yang sama (date sama), masih Pending, tanpa updatedAt
    const cloudTx = makeTx('X', localCommitAt, [makeItem('m1', 1)]); // status default Pending
    useTransactionStore.getState().loadFromCloud([cloudTx], true);

    const after = useTransactionStore.getState().transactions.find((t) => t.id === 'X');
    expect(after?.txStatus).toBe('Cancel'); // void lokal dipertahankan (updatedAt lokal > date cloud)
  });

  it('updatedAt lebih unggul dari date: lokal void menang walau cloud punya date lebih baru', () => {
    const now = Date.now();
    const localCommitAt = new Date(now - 2 * 60 * 60 * 1000).toISOString(); // commit 2 jam lalu
    const localVoidAt = new Date(now - 30 * 60 * 1000).toISOString(); // void 30 menit lalu
    const cloudCommitAt = new Date(now - 60 * 60 * 1000).toISOString(); // cloud re-commit 1 jam lalu (date LEBIH BARU)

    // Lokal: commit lebih TUA tapi void-nya (updatedAt) lebih BARU dari commit cloud
    const localTx = {
      ...makeTx('X', localCommitAt, [makeItem('m1', 1)], 'Cancel'),
      updatedAt: localVoidAt,
    } as Transaction;
    useTransactionStore.setState({ transactions: [localTx] });

    // Cloud: device lain re-commit items dengan date lebih baru, tapi updatedAt lebih tua dari void lokal
    const cloudTx = {
      ...makeTx('X', cloudCommitAt, [makeItem('m1', 1), makeItem('m2', 1)], 'Pending'),
      updatedAt: cloudCommitAt,
    } as Transaction;
    useTransactionStore.getState().loadFromCloud([cloudTx], true);

    const after = useTransactionStore.getState().transactions.find((t) => t.id === 'X');
    expect(after?.txStatus).toBe('Cancel'); // freshness updatedAt otoritatif (localVoidAt > cloudCommitAt)
  });

  it('cloud updatedAt lebih baru → cloud menang', () => {
    const localTx = {
      ...makeTx('X', '2026-08-15T09:00:00.000Z', [makeItem('m1', 1)]),
      updatedAt: '2026-08-15T09:30:00.000Z',
    } as Transaction;
    useTransactionStore.setState({ transactions: [localTx] });
    const cloudTx = {
      ...makeTx('X', '2026-08-15T09:00:00.000Z', [makeItem('m1', 1), makeItem('m2', 1)], 'Pending'),
      updatedAt: '2026-08-15T10:00:00.000Z',
    } as Transaction;

    useTransactionStore.getState().loadFromCloud([cloudTx], true);

    const after = useTransactionStore.getState().transactions.find((t) => t.id === 'X');
    expect(after?.items.map((i) => i.menuId).sort()).toEqual(['m1', 'm2']);
  });

  it('legacy tanpa updatedAt di kedua sisi → fallback date', () => {
    const localTx = makeTx('X', '2026-08-15T09:00:00.000Z', [makeItem('m1', 1), makeItem('m2', 1)]);
    useTransactionStore.setState({ transactions: [localTx] });
    const cloudTx = makeTx('X', '2026-08-15T10:00:00.000Z', [makeItem('m1', 1), makeItem('m3', 1)]);

    useTransactionStore.getState().loadFromCloud([cloudTx], true);

    const after = useTransactionStore.getState().transactions.find((t) => t.id === 'X');
    expect(after?.items.map((i) => i.menuId).sort()).toEqual(['m1', 'm3']); // cloud (date lebih baru) menang
  });

  it('deletion lintas device tetap berlaku (lokal ada, cloud tidak ada, di dalam window → di-drop)', () => {
    const localX = makeTx('X', '2026-08-15T10:00:00.000Z', [makeItem('m1', 1)]); // dihapus di cloud
    const localOld = makeTx('Y', '2026-08-14T08:00:00.000Z', [makeItem('m2', 1)]); // di luar window
    useTransactionStore.setState({ transactions: [localX, localOld] });

    // Cloud hanya punya Z (window boundary 09:00) — X tidak ada → dianggap dihapus di device lain
    const cloudOther = makeTx('Z', '2026-08-14T09:00:00.000Z', [makeItem('m3', 1)]);
    useTransactionStore.getState().loadFromCloud([cloudOther], true);

    const ids = useTransactionStore.getState().transactions.map((t) => t.id);
    expect(ids).not.toContain('X'); // dihapus di cloud → ikut terhapus lokal
    expect(ids).toContain('Y'); // lebih tua dari window → dipertahankan
    expect(ids).toContain('Z');
  });
});
