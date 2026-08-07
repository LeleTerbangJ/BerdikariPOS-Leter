import { describe, it, expect } from 'vitest';
import {
  pruneIdempotencyEntries,
  IDEMPOTENCY_TTL_MS,
  type ProcessedRegistryEntry,
} from '../utils/idempotencyCleanup';

function makeEntry(state: ProcessedRegistryEntry['state'], ageMs: number): ProcessedRegistryEntry {
  return {
    state,
    timestamp: new Date(Date.now() - ageMs).toISOString(),
  };
}

describe('pruneIdempotencyEntries (TO DO 2.4 — TTL & batas ukuran)', () => {
  it('hapus entry yang lebih tua dari TTL (24 jam)', () => {
    const map = new Map<string, ProcessedRegistryEntry>([
      ['old', makeEntry('SYNCED', IDEMPOTENCY_TTL_MS + 60_000)],
      ['fresh', makeEntry('COMMITTED', 1_000)],
    ]);
    pruneIdempotencyEntries(map, Date.now());
    expect(map.has('old')).toBe(false);
    expect(map.has('fresh')).toBe(true);
  });

  it('entry persis di TTL (age === ttl) dipertahankan', () => {
    const map = new Map<string, ProcessedRegistryEntry>([
      ['boundary', makeEntry('SYNCED', IDEMPOTENCY_TTL_MS)],
    ]);
    pruneIdempotencyEntries(map, Date.now());
    expect(map.has('boundary')).toBe(true);
  });

  it('batasi ukuran map: buang entry tertua saat melebihi maxSize', () => {
    const map = new Map<string, ProcessedRegistryEntry>();
    // tx-0 paling tua, tx-4 paling baru
    for (let i = 0; i < 5; i++) {
      map.set(`tx-${i}`, makeEntry('SYNCED', (5 - i) * 1_000));
    }
    pruneIdempotencyEntries(map, Date.now(), 60_000, 3);
    expect(map.size).toBe(3);
    expect(map.has('tx-0')).toBe(false);
    expect(map.has('tx-1')).toBe(false);
    expect(map.has('tx-2')).toBe(true);
    expect(map.has('tx-3')).toBe(true);
    expect(map.has('tx-4')).toBe(true);
  });

  it('entry in-flight (VALIDATING/PROCESSING) yang masih muda tidak terhapus', () => {
    const map = new Map<string, ProcessedRegistryEntry>([
      ['inflight', makeEntry('PROCESSING', 500)],
    ]);
    pruneIdempotencyEntries(map, Date.now(), 10_000, 100);
    expect(map.has('inflight')).toBe(true);
  });

  it('TTL 0 → semua entry dengan usia > 0 dihapus', () => {
    const map = new Map<string, ProcessedRegistryEntry>([
      ['a', makeEntry('COMMITTED', 5_000)],
      ['b', makeEntry('SYNCED', 5_000)],
    ]);
    pruneIdempotencyEntries(map, Date.now(), 0, 100);
    expect(map.size).toBe(0);
  });

  it('boundary: size === maxSize → tidak ada yang dibuang', () => {
    const map = new Map<string, ProcessedRegistryEntry>();
    for (let i = 0; i < 3; i++) {
      map.set(`tx-${i}`, makeEntry('SYNCED', 1_000));
    }
    pruneIdempotencyEntries(map, Date.now(), 60_000, 3);
    expect(map.size).toBe(3);
    expect(map.has('tx-0')).toBe(true);
    expect(map.has('tx-2')).toBe(true);
  });

  it('kombinasi TTL + batas ukuran: entry tua dihapus TTL, lalu sisanya dibatasi', () => {
    const map = new Map<string, ProcessedRegistryEntry>([
      ['expired', makeEntry('SYNCED', 120_000)], // lebih tua dari TTL 60s
      ['a', makeEntry('SYNCED', 1_000)],
      ['b', makeEntry('SYNCED', 2_000)],
      ['c', makeEntry('SYNCED', 3_000)],
      ['d', makeEntry('SYNCED', 4_000)],
    ]);
    pruneIdempotencyEntries(map, Date.now(), 60_000, 2);
    expect(map.has('expired')).toBe(false);
    expect(map.size).toBe(2);
    // ageMs lebih besar = lebih tua → d (4s) dan c (3s) adalah dua tertua yang dibuang
    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(true);
    expect(map.has('c')).toBe(false);
    expect(map.has('d')).toBe(false);
  });
});
