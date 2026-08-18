import { describe, it, expect } from 'vitest';
import { localMaxQueueNumber, findDuplicateQueueNumbers, toLocalDateKey } from '../utils/queueNumber';
import type { Transaction } from '../types';

function tx(id: string, queueNumber: number, date: string, txStatus: Transaction['txStatus'] = 'Selesai'): Transaction {
  return {
    id,
    queueNumber,
    date,
    txStatus,
    isPending: txStatus === 'Pending',
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
    updatedAt: date,
  } as Transaction;
}

describe('toLocalDateKey (v4.7 TO DO 18.3 — fix UTC vs tanggal lokal)', () => {
  it('mengonversi timestamp UTC ke tanggal LOKAL device', () => {
    // new Date(y, m, d, h) = waktu LOKAL → UTC ISO bisa berbeda tanggalnya;
    // toLocalDateKey harus mengembalikan tanggal LOKAL aslinya.
    const earlyMorning = new Date(2026, 7, 18, 6, 30).toISOString(); // 06:30 pagi lokal
    expect(toLocalDateKey(earlyMorning)).toBe('2026-08-18');
    // Malam hari lokal (UTC bisa berbeda tanggal tergantung TZ device) — tetap tanggal lokal
    expect(toLocalDateKey(new Date(2026, 7, 18, 23, 59).toISOString())).toBe('2026-08-18');
  });

  it('string non-parseable → prefix ISO (fallback aman)', () => {
    expect(toLocalDateKey('2026-08-15')).toBe('2026-08-15');
    expect(toLocalDateKey(undefined)).toBe('');
  });
});

describe('localMaxQueueNumber (TO DO 18.2 + 18.3)', () => {
  it('mengembalikan max nomor hari ini (Demo/Cancel dikecualikan)', () => {
    const txs = [
      tx('a', 5, '2026-08-15T08:00:00.000Z'),
      tx('b', 9, '2026-08-15T09:00:00.000Z'),
      tx('c', 3, '2026-08-15T10:00:00.000Z'),
      tx('d', 99, '2026-08-15T11:00:00.000Z', 'Demo'),
      tx('e', 50, '2026-08-15T12:00:00.000Z', 'Cancel'),
    ];
    expect(localMaxQueueNumber(txs, '2026-08-15')).toBe(9);
  });

  it('transaksi tanggal lain TIDAK dihitung', () => {
    const txs = [tx('a', 7, '2026-08-14T08:00:00.000Z')];
    expect(localMaxQueueNumber(txs, '2026-08-15')).toBe(0);
  });

  it('kosong / tanpa nomor → 0', () => {
    expect(localMaxQueueNumber([], '2026-08-15')).toBe(0);
    expect(localMaxQueueNumber([tx('a', 0, '2026-08-15T08:00:00.000Z')], '2026-08-15')).toBe(0);
  });

  it('v4.7 TO DO 18.3: transaksi pagi buta (UTC = tanggal sebelumnya) TETAP terhitung', () => {
    // Transaksi pukul 06:30 PAGI lokal → UTC bisa jatuh di tanggal sebelumnya
    // (mis. WIB: 2026-08-17T23:30Z). Prefix UTC TIDAK boleh dipakai — tanggal lokal yang benar.
    const earlyMorningIso = new Date(2026, 7, 18, 6, 30).toISOString();
    const txs = [tx('a', 7, earlyMorningIso)];
    expect(localMaxQueueNumber(txs, '2026-08-18')).toBe(7);
  });
});

describe('findDuplicateQueueNumbers (TO DO 18.2 — badge #N duplikat)', () => {
  it('dua transaksi #5 di hari yang sama → {5}', () => {
    const txs = [
      tx('a', 5, '2026-08-15T08:00:00.000Z'),
      tx('b', 5, '2026-08-15T09:30:00.000Z'),
      tx('c', 6, '2026-08-15T10:00:00.000Z'),
    ];
    expect(Array.from(findDuplicateQueueNumbers(txs))).toEqual([5]);
  });

  it('nomor sama di TANGGAL berbeda → bukan duplikat (nomor reset harian)', () => {
    const txs = [
      tx('a', 5, '2026-08-14T08:00:00.000Z'),
      tx('b', 5, '2026-08-15T08:00:00.000Z'),
    ];
    expect(findDuplicateQueueNumbers(txs).size).toBe(0);
  });

  it('Demo/Cancel dikecualikan dari deteksi', () => {
    const txs = [
      tx('a', 5, '2026-08-15T08:00:00.000Z'),
      tx('b', 5, '2026-08-15T09:00:00.000Z', 'Demo'),
      tx('c', 5, '2026-08-15T10:00:00.000Z', 'Cancel'),
    ];
    expect(findDuplicateQueueNumbers(txs).size).toBe(0);
  });

  it('tiga transaksi #7 → {7}; beberapa nomor duplikat sekaligus', () => {
    const txs = [
      tx('a', 7, '2026-08-15T08:00:00.000Z'),
      tx('b', 7, '2026-08-15T09:00:00.000Z'),
      tx('c', 7, '2026-08-15T10:00:00.000Z'),
      tx('d', 12, '2026-08-15T11:00:00.000Z'),
      tx('e', 12, '2026-08-15T12:00:00.000Z'),
    ];
    expect(Array.from(findDuplicateQueueNumbers(txs)).sort((a, b) => a - b)).toEqual([7, 12]);
  });

  it('tanpa duplikat / kosong → Set kosong; nomor 0 diabaikan', () => {
    expect(findDuplicateQueueNumbers([]).size).toBe(0);
    expect(
      findDuplicateQueueNumbers([
        tx('a', 1, '2026-08-15T08:00:00.000Z'),
        tx('b', 2, '2026-08-15T09:00:00.000Z'),
        tx('c', 0, '2026-08-15T10:00:00.000Z'),
      ]).size
    ).toBe(0);
  });

  it('v4.7 TO DO 18.8 (A7): sub-bill split (berbagi 1 nomor antrean) TIDAK dianggap duplikat', () => {
    // 1 pesanan di-split 3 sub-bill — semua memakai #5 (fresh & pending split seragam 1 nomor)
    const txs = [
      tx('parent', 5, '2026-08-15T08:00:00.000Z'),
      tx('sub1', 5, '2026-08-15T08:05:00.000Z', 'Selesai'),
      tx('sub2', 5, '2026-08-15T08:10:00.000Z', 'Selesai'),
    ];
    txs[1].splitParentId = 'parent';
    txs[1].splitIndex = 1;
    txs[2].splitParentId = 'parent';
    txs[2].splitIndex = 2;
    // Sub-bill split fresh (tanpa splitParentId, hanya splitIndex)
    const freshSub = tx('fresh-sub', 9, '2026-08-15T09:00:00.000Z', 'Selesai');
    freshSub.splitIndex = 1;
    freshSub.totalSplitCount = 2;
    expect(findDuplicateQueueNumbers([...txs, freshSub]).size).toBe(0);
  });

  it('v4.7 TO DO 18.8 (A7): duplikat ANTAR PESANAN BERBEDA tetap terdeteksi (2 kasir offline)', () => {
    const a = tx('a', 5, '2026-08-15T08:00:00.000Z');
    const b = tx('b', 5, '2026-08-15T08:30:00.000Z');
    const c = tx('c', 5, '2026-08-15T08:45:00.000Z');
    c.splitIndex = 1; // sub-bill split — TIDAK ikut dihitung
    expect(Array.from(findDuplicateQueueNumbers([a, b, c]))).toEqual([5]);
  });

  it('v4.7 TO DO 18.3: duplikat pagi buta dikelompokkan per tanggal LOKAL (bukan prefix UTC)', () => {
    // Dua transaksi #5 pada 06:30 & 23:30 lokal — UTC-nya bisa beda tanggal (WIB),
    // tapi tetap harus terdeteksi sebagai duplikat di HARI LOKAL yang sama.
    const txs = [
      tx('a', 5, new Date(2026, 7, 18, 6, 30).toISOString()),
      tx('b', 5, new Date(2026, 7, 18, 23, 30).toISOString()),
    ];
    expect(findDuplicateQueueNumbers(txs).size).toBe(1);
    // Tanggal lokal berbeda → bukan duplikat (reset harian)
    const other = [
      tx('a', 5, new Date(2026, 7, 17, 23, 30).toISOString()),
      tx('b', 5, new Date(2026, 7, 18, 6, 30).toISOString()),
    ];
    expect(findDuplicateQueueNumbers(other).size).toBe(0);
  });
});

// ============================================================================
// Kontrak RPC allocate_queue_number (TO DO 18.2) — model semantik SQL di JS.
// Bukan eksekusi SQL (Postgres), tapi mengunci SPESIFIKASI counter agar refactor
// tidak mengubah perilaku: nomor pertama = max(0, p_min) + 1 (branch INSERT),
// berikutnya = GREATEST(last + 1, p_min + 1) (branch ON CONFLICT DO UPDATE).
// ============================================================================
describe('kontrak allocate_queue_number (TO DO 18.2)', () => {
  function simulateAllocate(state: Map<string, number>, date: string, pMin: number): number {
    const prev = state.get(date);
    let next: number;
    if (prev === undefined) {
      next = Math.max(0, pMin) + 1; // branch INSERT
    } else {
      next = Math.max(prev + 1, pMin + 1); // branch ON CONFLICT DO UPDATE
    }
    state.set(date, next);
    return next;
  }

  it('counter baru: nomor pertama = floor + 1 (tidak menabrak transaksi yang sudah ada)', () => {
    const state = new Map<string, number>();
    expect(simulateAllocate(state, '2026-08-15', 5)).toBe(6); // max lokal 5 → berikutnya 6
    expect(simulateAllocate(state, '2026-08-15', 5)).toBe(7);
  });

  it('hari pertama (floor 0) → nomor 1, 2, 3 ...', () => {
    const state = new Map<string, number>();
    expect(simulateAllocate(state, '2026-08-15', 0)).toBe(1);
    expect(simulateAllocate(state, '2026-08-15', 0)).toBe(2);
  });

  it('dua kasir bersamaan dengan floor sama → nomor SELALU unik & berurutan (row lock serialisasi)', () => {
    const state = new Map<string, number>();
    // Kasir A & B sama-sama membaca max 5 → floor 5
    const a = simulateAllocate(state, '2026-08-15', 5); // 6
    const b = simulateAllocate(state, '2026-08-15', 5); // 7 (bukan 6!)
    const c = simulateAllocate(state, '2026-08-15', 5); // 8
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toBe(6);
    expect(b).toBe(7);
    expect(c).toBe(8);
  });

  it('floor lebih tinggi dari counter (data lama ditemukan belakangan) → counter melompat ke floor + 1', () => {
    const state = new Map<string, number>();
    simulateAllocate(state, '2026-08-15', 0); // 1
    // Ternyata sudah ada transaksi #10 dari device lama → floor 10
    expect(simulateAllocate(state, '2026-08-15', 10)).toBe(11);
  });

  it('counter per TANGGAL terpisah (nomor reset harian)', () => {
    const state = new Map<string, number>();
    simulateAllocate(state, '2026-08-15', 0); // 1
    expect(simulateAllocate(state, '2026-08-16', 0)).toBe(1);
  });
});
