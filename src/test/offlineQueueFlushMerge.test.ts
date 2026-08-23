import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// K6 fix (AUDIT-OX): op baru yang masuk via addToQueue() SELAMA flushQueue()
// berjalan TIDAK boleh hilang tertimpa saveQueue(remaining) di akhir flush.
// Skenario: upsert pertama ditahan (gate), mid-flush tambah op baru + replace
// op yang sedang dieksekusi, lalu lepas gate → semua op harus selamat.
// ============================================================================

type Gate = { promise: Promise<{ error: any }>; resolve: (r: { error: any }) => void };

const gates: Gate[] = [];

function makeGate(): { error: any } {
  let resolve!: (r: { error: any }) => void;
  const promise = new Promise<{ error: any }>((r) => { resolve = r; });
  gates.push({ promise, resolve });
  return promise as unknown as { error: any };
}

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: (_table: string) => ({
      // Upsert DITAHAN sampai gate dilepas → simulasi network lambat
      upsert: async () => makeGate(),
      insert: async () => ({ error: null }),
      update: async () => ({ error: null }),
      delete: async () => ({ error: null }),
    }),
  },
}));

import { addToQueue, flushQueue, getQueuedOperations, clearQueue, getQueueLength } from '../lib/offlineQueue';

function tick(times = 6): Promise<void> {
  let p: Promise<void> = Promise.resolve();
  for (let i = 0; i < times; i++) p = p.then(() => new Promise<void>((r) => setTimeout(r, 0)));
  return p;
}

describe('flushQueue merge (K6 fix - AUDIT-OX)', () => {
  beforeEach(() => {
    clearQueue();
    gates.length = 0;
  });

  it('op baru yang masuk saat flush berjalan TIDAK hilang', async () => {
    // 1. Antrekan op pertama (transaksi tx-1)
    addToQueue({ action: 'upsert', table: 'transactions', data: { id: 'tx-1', total: 100 } });

    // 2. Mulai flush tanpa await — eksekusi tx-1 tertahan di gate
    const flushPromise = flushQueue();
    await tick(); // biar loop mencapai upsert tx-1 dan menunggu gate

    // 3. Selagi flush menggantung: kasir membuat transaksi BARU + update record lain
    addToQueue({ action: 'upsert', table: 'transactions', data: { id: 'tx-2', total: 200 } });
    addToQueue({ action: 'upsert', table: 'customers', data: { id: 'cust-1', name: 'Budi' } });

    // 4. Lepas gate → tx-1 sukses, flush selesai
    for (const g of gates) g.resolve({ error: null });
    await flushPromise;

    // 5. Semua op harus selamat: tx-1 (sukses), tx-2 & cust-1 (masuk saat flush)
    const queue = getQueuedOperations();
    const ids = queue.map((o) => `${o.table}:${o.data?.id}`).sort();
    expect(ids).toEqual(['customers:cust-1', 'transactions:tx-2']);
    expect(getQueueLength()).toBe(2);
  });

  it('op SUKSES yang di-replace in-place saat flush → versi terbaru diantrekan ulang', async () => {
    addToQueue({ action: 'upsert', table: 'transactions', data: { id: 'tx-1', total: 100 } });

    const flushPromise = flushQueue();
    await tick();

    // Replace in-place (id sama dipertahankan oleh addToQueue) dengan data lebih baru
    addToQueue({ action: 'upsert', table: 'transactions', data: { id: 'tx-1', total: 999 } });

    for (const g of gates) g.resolve({ error: null });
    await flushPromise;

    const queue = getQueuedOperations();
    // Versi lama (total 100) sudah tersync; versi baru (999) belum → HARUS masih di antrean
    expect(queue.length).toBe(1);
    expect(queue[0].data?.total).toBe(999);
  });

  it('tanpa operasi konkuren → perilaku identik kode lama (semua sukses → antrean kosong)', async () => {
    addToQueue({ action: 'upsert', table: 'menus', data: { id: 'm-1' } });
    const flushPromise = flushQueue();
    await tick();
    for (const g of gates) g.resolve({ error: null });
    const res = await flushPromise;
    expect(res.success).toBe(1);
    expect(getQueueLength()).toBe(0);
  });
});
