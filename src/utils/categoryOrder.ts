/**
 * Urutan Tab Kategori POS — v4.7 (TO DO 11 — fitur baru)
 *
 * Murni & tanpa efek samping:
 * - buildCategoryTabs : susun tab kategori (dengan tab sistem di depan) berdasarkan urutan
 *                       customCategories yang diatur pengguna, sisanya ikut urutan menu.
 * - reorderTabs       : pindahkan item dari posisi `from` ke slot item `to` (item lain bergeser).
 */

/** Tab sistem yang selalu di depan dan tidak bisa diurutkan ulang. */
export const SYSTEM_TABS = ['Semua', 'Best Seller'] as const;

/**
 * Susun daftar tab kategori untuk badge row POS.
 * - 'Semua' & 'Best Seller' selalu di depan (tab sistem).
 * - Kategori yang ada di `customCategories` (urutan diatur pengguna) ditampilkan lebih dulu,
 *   sesuai urutan tersimpan — hanya jika kategori tersebut benar-benar punya menu.
 * - Kategori dari menu yang belum ada di customCategories ditambahkan di akhir (urut kemunculan).
 */
export function buildCategoryTabs(customCategories: string[], menuCategories: string[]): string[] {
  const menuSet = new Set(menuCategories);
  const ordered = customCategories.filter((c) => menuSet.has(c));
  const rest: string[] = [];
  for (const c of menuCategories) {
    if (!ordered.includes(c) && !rest.includes(c)) rest.push(c);
  }
  return [...SYSTEM_TABS, ...ordered, ...rest];
}

/**
 * Pindahkan `from` ke slot item `to` (item lain ikut bergeser).
 * Konvensi "drop di atas item X" → item yang diseret mengambil posisi X.
 * Mengembalikan array baru; no-op bila from/to tidak ditemukan atau sama.
 */
export function reorderTabs(list: string[], from: string, to: string): string[] {
  if (!from || !to || from === to) return [...list];
  const fromIdx = list.indexOf(from);
  const toIdx = list.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return [...list];
  const next = [...list];
  next.splice(fromIdx, 1);
  // Setelah `from` dihapus, indeks target bergeser kiri 1 bila target berada di belakangnya.
  const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
  next.splice(insertIdx, 0, from);
  return next;
}
