import { describe, it, expect } from 'vitest';
import { computeSyncFreshness } from '../components/SyncFreshnessBanner';

// v4.7 TO DO 18.6 — indikator "laporan belum final" saat ada data belum tersinkron
// (reuse badge O-5 / confirmedSyncIds). Logika murni diuji tanpa render React.

const txs = (ids: string[]) => ids.map((id) => ({ id }));

describe('computeSyncFreshness (TO DO 18.6 — laporan belum final)', () => {
  it('semua transaksi tersinkron & tanpa antrean → banner TIDAK tampil', () => {
    const r = computeSyncFreshness(txs(['a', 'b']), ['a', 'b'], 0);
    expect(r.show).toBe(false);
    expect(r.unsyncedTx).toBe(0);
  });

  it('ada transaksi belum tersinkron → banner tampil dengan jumlah yang benar', () => {
    const r = computeSyncFreshness(txs(['a', 'b', 'c']), ['a'], 0);
    expect(r.show).toBe(true);
    expect(r.unsyncedTx).toBe(2);
  });

  it('tanpa transaksi sama sekali → tidak tampil walau confirmedSyncIds kosong', () => {
    const r = computeSyncFreshness([], [], 0);
    expect(r.show).toBe(false);
    expect(r.unsyncedTx).toBe(0);
  });

  it('semua transaksi tersinkron TAPI ada operasi antrean → banner tetap tampil', () => {
    const r = computeSyncFreshness(txs(['a']), ['a'], 3);
    expect(r.show).toBe(true);
    expect(r.unsyncedTx).toBe(0);
  });

  it('campuran: transaksi belum sync + operasi antrean → tampil dengan kedua sinyal', () => {
    const r = computeSyncFreshness(txs(['a', 'b']), [], 2);
    expect(r.show).toBe(true);
    expect(r.unsyncedTx).toBe(2);
  });

  it('transaksi Demo/Cancel yang belum sync tetap dihitung (data lokal apa pun = belum final)', () => {
    const t = [
      { id: 's', txStatus: 'Selesai' },
      { id: 'd', txStatus: 'Demo' },
    ];
    const r = computeSyncFreshness(t, [], 0);
    expect(r.unsyncedTx).toBe(2);
    expect(r.show).toBe(true);
  });
});
