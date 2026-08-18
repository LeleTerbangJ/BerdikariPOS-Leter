import { describe, expect, it } from 'vitest';
import { buildCustomDateRange } from '../utils/format';

describe('buildCustomDateRange (TO DO 20.4 / G-3 — filter tanggal custom lokal)', () => {
  it('parses start date as LOCAL midnight, not UTC midnight', () => {
    const { from } = buildCustomDateRange('2026-08-13');
    // 2026-08-13T00:00:00 lokal — jam 0 menit 0 pada tanggal yang sama di zona waktu mana pun
    expect(from.getFullYear()).toBe(2026);
    expect(from.getMonth()).toBe(7); // Agustus
    expect(from.getDate()).toBe(13);
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(from.getSeconds()).toBe(0);
  });

  it('includes an early-morning (03:00 lokal) transaction on the start day', () => {
    // Regresi utama: dengan parse UTC lama, `new Date('2026-08-13')` = 07:00 WIB
    // sehingga transaksi 03:00 pagi tidak masuk range. Sekarang harus masuk.
    const tx = new Date(2026, 7, 13, 3, 0, 0);
    const { from, to } = buildCustomDateRange('2026-08-13', '2026-08-13');
    expect(tx >= from).toBe(true);
    expect(tx <= to).toBe(true);
  });

  it('includes a transaction at the very end of the last day (23:59:59.500)', () => {
    const tx = new Date(2026, 7, 15, 23, 59, 59, 500);
    const { from, to } = buildCustomDateRange('2026-08-13', '2026-08-15');
    expect(tx >= from).toBe(true);
    expect(tx <= to).toBe(true);
  });

  it('excludes transactions before the start day and after the end day', () => {
    const { from, to } = buildCustomDateRange('2026-08-13', '2026-08-15');
    const before = new Date(2026, 7, 12, 23, 59, 59);
    const after = new Date(2026, 7, 16, 0, 0, 0);
    expect(before >= from).toBe(false);
    expect(after <= to).toBe(false);
  });

  it('falls back to epoch/now when inputs are empty', () => {
    const { from, to } = buildCustomDateRange();
    expect(from.getTime()).toBe(0);
    expect(to.getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
  });
});
