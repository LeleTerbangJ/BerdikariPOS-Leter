import { describe, it, expect, vi } from 'vitest';

// Stub modul supabase — fetchTransactionsFromCloud membaca rows di bawah.
// Rows didefinisikan DI DALAM factory mock (vi.mock di-hoist di atas konstanta modul).
vi.mock('../lib/supabase', () => {
  const rows = [
    // Row STALE (akar bug 5.10): is_pending=true di DB tapi tx_status='Selesai' —
    // terjadi pada order yang dilunasi/dibatalkan di era sebelum syncTransactionTxStatus
    // ikut menulis is_pending → device lain sempat melihatnya sebagai Pending.
    {
      id: 't1',
      queue_number: 1,
      date: '2026-08-08T10:00:00.000Z',
      items: [],
      subtotal: 0,
      discount: 0,
      total_amount: 0,
      payment_method: 'Cash',
      cash_received: null,
      change: null,
      kitchen_status: 'Done',
      tx_status: 'Selesai',
      cashier_id: 'u1',
      cashier_name: 'Kasir',
      customer_id: null,
      customer_name: null,
      hpp: 0,
      tax: 0,
      order_type: null,
      table_number: null,
      table_name: null,
      is_pending: true, // STALE
      pending_notes: null,
      split_parent_id: null,
      split_index: null,
      total_split_count: null,
      paid_amount: null,
      applied_promo_id: null,
      voucher_code: null,
    },
    // Pending aktif: tx_status='Pending', is_pending=false (konsisten)
    {
      id: 't2',
      queue_number: 2,
      date: '2026-08-08T10:01:00.000Z',
      items: [],
      subtotal: 0,
      discount: 0,
      total_amount: 0,
      payment_method: 'Cash',
      cash_received: null,
      change: null,
      kitchen_status: 'Waiting',
      tx_status: 'Pending',
      cashier_id: 'u1',
      cashier_name: 'Kasir',
      customer_id: null,
      customer_name: null,
      hpp: 0,
      tax: 0,
      order_type: null,
      table_number: null,
      table_name: null,
      is_pending: false,
      pending_notes: null,
      split_parent_id: null,
      split_index: null,
      total_split_count: null,
      paid_amount: null,
      applied_promo_id: 'promo-x',
      voucher_code: 'HEM10',
    },
    // Sub-bill split FRESH: tanpa split_parent_id, hanya split_index/total_split_count
    {
      id: 't3',
      queue_number: 3,
      date: '2026-08-08T10:02:00.000Z',
      items: [],
      subtotal: 0,
      discount: 0,
      total_amount: 0,
      payment_method: 'QRIS',
      cash_received: null,
      change: null,
      kitchen_status: 'Waiting',
      tx_status: 'Selesai',
      cashier_id: 'u1',
      cashier_name: 'Kasir',
      customer_id: null,
      customer_name: null,
      hpp: 0,
      tax: 0,
      order_type: null,
      table_number: null,
      table_name: null,
      is_pending: false,
      pending_notes: null,
      split_parent_id: null,
      split_index: 1,
      total_split_count: 2,
      paid_amount: null,
      applied_promo_id: null,
      voucher_code: null,
    },
  ];

  return {
    isSupabaseConfigured: true,
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: rows, error: null })),
          })),
        })),
      })),
    },
  };
});

import { fetchTransactionsFromCloud } from '../lib/cloudSync';

describe('fetchTransactionsFromCloud mapping (TO DO 5.10 — is_pending lintas device)', () => {
  it('isPending otoritatif dari tx_status — kolom is_pending stale tidak membuat order lunas terlihat Pending', async () => {
    const result = await fetchTransactionsFromCloud();
    expect(result).not.toBeNull();

    const t1 = result!.find((t) => t.id === 't1')!;
    const t2 = result!.find((t) => t.id === 't2')!;

    // t1: is_pending=true stale di DB, tapi tx_status 'Selesai' → harus TIDAK pending
    expect(t1.txStatus).toBe('Selesai');
    expect(t1.isPending).toBe(false);

    // t2: tx_status 'Pending' → pending (walau kolom is_pending false, tx_status menang)
    expect(t2.isPending).toBe(true);
  });

  it('sub-bill split fresh: splitIndex & totalSplitCount terpetakan tanpa splitParentId', async () => {
    const result = await fetchTransactionsFromCloud();
    expect(result).not.toBeNull();

    const t3 = result!.find((t) => t.id === 't3')!;
    expect(t3.splitIndex).toBe(1);
    expect(t3.totalSplitCount).toBe(2);
    expect(t3.splitParentId).toBeUndefined();
  });

  it('TO DO 5.5: appliedPromoId & voucherCode pending terpetakan dari cloud (restore lintas device)', async () => {
    const result = await fetchTransactionsFromCloud();
    expect(result).not.toBeNull();

    const t2 = result!.find((t) => t.id === 't2')!;
    expect(t2.appliedPromoId).toBe('promo-x');
    expect(t2.voucherCode).toBe('HEM10');

    // Transaksi tanpa promo → undefined
    const t1 = result!.find((t) => t.id === 't1')!;
    expect(t1.appliedPromoId).toBeUndefined();
    expect(t1.voucherCode).toBeUndefined();
  });
});
