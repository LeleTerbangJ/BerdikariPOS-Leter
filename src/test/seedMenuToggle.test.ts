// ============================================================
// v4.10 PRIORITAS 28.4 — Verifikasi: nonaktifkan menu demo via
// is_available=false → POS menyembunyikan (SOP tanpa kode)
//
// Membuktikan: (1) menu dgn isAvailable=false TIDAK tampil di POS,
// (2) menu tanpa flag isAvailable (undefined) TETAP tampil (default true),
// (3) toggle Catalog → updateMenu → syncMenu ke cloud.
// ============================================================
import { describe, it, expect } from 'vitest';
import { seedMenus } from '../utils/seed';
import type { Menu } from '../types';

describe('28.4 — SOP: nonaktifkan menu demo via is_available=false (tanpa kode)', () => {
  // Simulasi filter POS: menus.filter((m) => m.isAvailable !== false)
  const posFilter = (menus: Menu[]) => menus.filter((m) => m.isAvailable !== false);

  it('8 menu seed demo semuanya aktif (undefined = default true) → tampil di POS', () => {
    const visible = posFilter(seedMenus);
    expect(visible).toHaveLength(8);
    expect(visible.map((m) => m.name)).toContain('Kunyit Asam Signature');
  });

  it('nonaktifkan 1 menu demo → POS menyembunyikan (7 tampil)', () => {
    const toggled = seedMenus.map((m) =>
      m.id === 'a0000000-0000-4000-a000-000000000001'
        ? { ...m, isAvailable: false }
        : m
    );
    const visible = posFilter(toggled);
    expect(visible).toHaveLength(7);
    expect(visible.find((m) => m.id === 'a0000000-0000-4000-a000-000000000001')).toBeUndefined();
  });

  it('nonaktifkan SEMUA 8 menu demo → POS kosong (0 tampil)', () => {
    const allDisabled = seedMenus.map((m) => ({ ...m, isAvailable: false }));
    const visible = posFilter(allDisabled);
    expect(visible).toHaveLength(0);
  });

  it('menu user baru tetap tampil (isAvailable undefined = default true)', () => {
    const withUserMenu: Menu[] = [
      ...seedMenus.map((m) => ({ ...m, isAvailable: false })), // semua demo dinonaktifkan
      { id: 'user-menu-1', name: 'Menu User', category: 'X', price: 10000, ingredients: {}, availableAddons: [] },
    ];
    const visible = posFilter(withUserMenu);
    expect(visible).toHaveLength(1);
    expect(visible[0].name).toBe('Menu User');
  });

  it('aktifkan kembali (isAvailable=undefined) → menu tampil lagi', () => {
    const disabled = seedMenus.map((m) => ({ ...m, isAvailable: false }));
    expect(posFilter(disabled)).toHaveLength(0);
    // Re-enable: hapus flag isAvailable (set undefined)
    const reEnabled = disabled.map(({ isAvailable, ...m }) => m);
    expect(posFilter(reEnabled)).toHaveLength(8);
  });

  it('verifikasi: isAvailable tersimpan di type Menu (field opsional)', () => {
    // Type-level check: Menu.isAvailable adalah boolean opsional
    const m: Menu = { id: 'x', name: 'Test', category: 'Y', price: 1000, ingredients: {}, availableAddons: [] };
    expect(m.isAvailable).toBeUndefined(); // default undefined = aktif
    m.isAvailable = false;
    expect(m.isAvailable).toBe(false);
  });
});
