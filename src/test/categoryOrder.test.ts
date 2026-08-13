import { describe, it, expect } from 'vitest';
import { SYSTEM_TABS, buildCategoryTabs, reorderTabs } from '../utils/categoryOrder';

describe('buildCategoryTabs', () => {
  it('selalu menaruh tab sistem Semua & Best Seller di depan', () => {
    const tabs = buildCategoryTabs(['Minuman', 'Makanan'], ['Makanan', 'Minuman']);
    expect(tabs.slice(0, 2)).toEqual(['Semua', 'Best Seller']);
  });

  it('menghormati urutan customCategories (yang diatur pengguna)', () => {
    const tabs = buildCategoryTabs(['Desert', 'Minuman', 'Makanan'], ['Minuman', 'Makanan', 'Desert', 'Snack']);
    expect(tabs).toEqual(['Semua', 'Best Seller', 'Desert', 'Minuman', 'Makanan', 'Snack']);
  });

  it('kategori menu yang belum ada di customCategories ditambahkan di akhir sesuai urutan kemunculan', () => {
    const tabs = buildCategoryTabs(['Minuman'], ['Makanan', 'Snack', 'Minuman']);
    expect(tabs).toEqual(['Semua', 'Best Seller', 'Minuman', 'Makanan', 'Snack']);
  });

  it('customCategories tanpa menu tidak muncul sebagai badge', () => {
    const tabs = buildCategoryTabs(['Kategori Hantu'], ['Minuman']);
    expect(tabs).toEqual(['Semua', 'Best Seller', 'Minuman']);
  });

  it('menghapus duplikat kategori dari menu', () => {
    const tabs = buildCategoryTabs([], ['Minuman', 'Minuman', 'Makanan', 'Minuman']);
    expect(tabs).toEqual(['Semua', 'Best Seller', 'Minuman', 'Makanan']);
  });

  it('empty no-op: tanpa menu hanya tab sistem', () => {
    expect(buildCategoryTabs([], [])).toEqual(['Semua', 'Best Seller']);
  });
});

describe('reorderTabs', () => {
  it('memindahkan item ke depan (from > to) — item lain bergeser ke kanan', () => {
    expect(reorderTabs(['A', 'B', 'C', 'D'], 'C', 'A')).toEqual(['C', 'A', 'B', 'D']);
  });

  it('memindahkan item ke belakang (from < to) — item mengambil slot target', () => {
    expect(reorderTabs(['A', 'B', 'C', 'D'], 'B', 'D')).toEqual(['A', 'C', 'B', 'D']);
  });

  it('memindahkan item pertama ke posisi tengah', () => {
    expect(reorderTabs(['A', 'B', 'C', 'D'], 'A', 'C')).toEqual(['B', 'A', 'C', 'D']);
  });

  it('no-op saat from === to', () => {
    expect(reorderTabs(['A', 'B', 'C'], 'B', 'B')).toEqual(['A', 'B', 'C']);
  });

  it('no-op saat from/to tidak ditemukan', () => {
    expect(reorderTabs(['A', 'B'], 'X', 'A')).toEqual(['A', 'B']);
    expect(reorderTabs(['A', 'B'], 'A', 'X')).toEqual(['A', 'B']);
  });

  it('tidak memutasi array asli', () => {
    const list = ['A', 'B', 'C'];
    const next = reorderTabs(list, 'A', 'C');
    expect(list).toEqual(['A', 'B', 'C']);
    expect(next).not.toBe(list);
  });

  it('urutan setelah drop konsisten dengan buildCategoryTabs (skenario POS)', () => {
    // POS: pengguna menyeret 'Makanan' ke slot 'Desert' pada tab hasil build
    let tabs = buildCategoryTabs(['Desert', 'Minuman', 'Makanan'], ['Minuman', 'Makanan', 'Desert', 'Snack']);
    const real = tabs.filter((c) => !SYSTEM_TABS.includes(c as any));
    tabs = ['Semua', 'Best Seller', ...reorderTabs(real, 'Makanan', 'Desert')];
    expect(tabs).toEqual(['Semua', 'Best Seller', 'Makanan', 'Desert', 'Minuman', 'Snack']);
  });
});
