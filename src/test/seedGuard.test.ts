// ============================================================
// v4.10 PRIORITAS 28 — Guard seed push (28.1) + tombstone (28.3)
//
// 28.1: isPureSeedCatalog mendeteksi katalog = seed demo murni;
//       catalogTouched flag diset saat user tambah/edit/hapus/import.
// 28.3: filterTombstoned + pruneConfirmedTombstones untuk menus
//       (anti re-hidrasi menu terhapus dari cloud).
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { isPureSeedCatalog, setCatalogTouched, clearCatalogTouched } from '../utils/seedGuard';
import { seedMenus } from '../utils/seed';
import { filterTombstoned, pruneConfirmedTombstones } from '../utils/storagePrune';
import type { Menu } from '../types';

// Fake localStorage untuk test flag catalogTouched
class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) ?? null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

beforeEach(() => {
  const backup = (globalThis as any).localStorage;
  const fake = new FakeStorage();
  (globalThis as any).localStorage = fake;
  // seedGuard memakai safeStorage yang membaca localStorage — injeksi
  (globalThis as any).window = { localStorage: fake };
  clearCatalogTouched();
});

// ============================================================
// 28.1 — isPureSeedCatalog (guard push seed ke cloud)
// ============================================================
describe('28.1 — isPureSeedCatalog (guard push seed murni)', () => {
  it('katalog = seed persis → true (seed murni, jangan push)', () => {
    clearCatalogTouched();
    expect(isPureSeedCatalog(seedMenus)).toBe(true);
  });

  it('katalog seed + 1 menu user → false (ada menu non-seed)', () => {
    clearCatalogTouched();
    const withUser: Menu[] = [
      ...seedMenus,
      { id: 'user-menu-1', name: 'Menu User', category: 'X', price: 10000, ingredients: {}, availableAddons: [] },
    ];
    expect(isPureSeedCatalog(withUser)).toBe(false);
  });

  it('katalog seed tapi kurang 1 (dihapus) → true (masih seed murni)', () => {
    clearCatalogTouched();
    const fewer = seedMenus.slice(1); // hilangkan menu pertama
    expect(isPureSeedCatalog(fewer)).toBe(true);
  });

  it('catalogTouched diset → false walau katalog = seed persis (user sudah aksi)', () => {
    setCatalogTouched();
    expect(isPureSeedCatalog(seedMenus)).toBe(false);
    clearCatalogTouched();
  });

  it('katalog kosong + !catalogTouched → true (tidak ada menu user)', () => {
    clearCatalogTouched();
    expect(isPureSeedCatalog([])).toBe(true);
  });

  it('katalog hanya menu user (tidak ada seed) → false', () => {
    clearCatalogTouched();
    const userOnly: Menu[] = [
      { id: 'user-1', name: 'A', category: 'X', price: 5000, ingredients: {}, availableAddons: [] },
      { id: 'user-2', name: 'B', category: 'Y', price: 7000, ingredients: {}, availableAddons: [] },
    ];
    expect(isPureSeedCatalog(userOnly)).toBe(false);
  });

  it('setCatalogTouched → isCatalogTouched true; clear → false', () => {
    clearCatalogTouched();
    setCatalogTouched();
    // Baca via isPureSeedCatalog — bila touched, harus return false walau seed persis
    expect(isPureSeedCatalog(seedMenus)).toBe(false);
    clearCatalogTouched();
    expect(isPureSeedCatalog(seedMenus)).toBe(true);
  });
});

// ============================================================
// 28.3 — Tombstone menus (anti re-hidrasi menu terhapus)
// ============================================================
describe('28.3 — tombstone menus (filterTombstoned + pruneConfirmedTombstones)', () => {
  it('filterTombstoned: menu terhapus tidak masuk hasil merge dari cloud', () => {
    const cloudMenus = [
      { id: 'm1', name: 'A' },
      { id: 'm2', name: 'B' },
      { id: 'm3-deleted', name: 'C' },
    ];
    const tombstoned = ['m3-deleted'];
    const filtered = filterTombstoned(cloudMenus, tombstoned);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('filterTombstoned: tanpa tombstone → semua lolos', () => {
    const cloudMenus = [{ id: 'm1' }, { id: 'm2' }];
    const filtered = filterTombstoned(cloudMenus, []);
    expect(filtered).toHaveLength(2);
  });

  it('pruneConfirmedTombstones: id yang tidak ada di cloud → dibuang (delete terkonfirmasi)', () => {
    const tombstones = ['m1-deleted', 'm2-deleted', 'm3-still-in-cloud'];
    const cloudIds = ['m3-still-in-cloud', 'm4', 'm5'];
    const pruned = pruneConfirmedTombstones(tombstones, cloudIds);
    expect(pruned).toEqual(['m3-still-in-cloud']);
  });

  it('pruneConfirmedTombstones: semua id sudah tiada di cloud → semua dibuang', () => {
    const tombstones = ['m1', 'm2'];
    const cloudIds = ['m3', 'm4'];
    const pruned = pruneConfirmedTombstones(tombstones, cloudIds);
    expect(pruned).toEqual([]);
  });

  it('pruneConfirmedTombstones: semua id masih ada di cloud → semua dipertahankan', () => {
    const tombstones = ['m1', 'm2'];
    const cloudIds = ['m1', 'm2', 'm3'];
    const pruned = pruneConfirmedTombstones(tombstones, cloudIds);
    expect(pruned).toEqual(['m1', 'm2']);
  });

  it('skenario lengkap: delete offline → fetch cloud → menu tidak kembali', () => {
    // User hapus m2 (tombstone), cloud masih punya m1+m2+m3
    const cloudMenus = [
      { id: 'm1', name: 'A' },
      { id: 'm2', name: 'B (dihapus)' },
      { id: 'm3', name: 'C' },
    ];
    const tombstones = ['m2'];
    // Step 1: filter tombstone dari cloudMenus
    const cloudFiltered = filterTombstoned(cloudMenus, tombstones);
    expect(cloudFiltered.find((m) => m.id === 'm2')).toBeUndefined();
    // Step 2: m2 masih ada di cloud → tombstone dipertahankan (delete belum ter-konfirmasi)
    const cloudIds = cloudMenus.map((m) => m.id);
    const pruned = pruneConfirmedTombstones(tombstones, cloudIds);
    expect(pruned).toEqual(['m2']); // tetap di tombstone
    // Step 3: bila cloud konfirmasi hapus (m2 tiada) → prune
    const cloudIdsAfterDelete = ['m1', 'm3'];
    const prunedAfter = pruneConfirmedTombstones(tombstones, cloudIdsAfterDelete);
    expect(prunedAfter).toEqual([]); // tombstone dibuang
  });
});
