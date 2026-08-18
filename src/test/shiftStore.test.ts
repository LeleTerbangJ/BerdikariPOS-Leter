import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/cloudSync', () => ({
  syncShift: vi.fn(),
  fetchShiftsFromCloud: vi.fn(),
}));

import { useShiftStore } from '../store/shiftStore';
import { syncShift, fetchShiftsFromCloud } from '../lib/cloudSync';
import type { CashierShift } from '../types';

const mockedFetch = vi.mocked(fetchShiftsFromCloud);
const mockedSync = vi.mocked(syncShift);

const openShift = (id: string, userName: string, openedAt: string): CashierShift => ({
  id,
  userId: `u-${id}`,
  userName,
  openedAt,
  openingCash: 100000,
  totalSales: 0,
  totalTransactions: 0,
  status: 'open',
});

beforeEach(() => {
  useShiftStore.setState({ shifts: [], activeShift: null });
  mockedFetch.mockReset();
  mockedSync.mockReset();
  mockedFetch.mockResolvedValue([]);
});

describe('shiftStore — v4.7 TO DO 18.3 (1 shift aktif per outlet)', () => {
  it('openShift tanpa shift terbuka → sukses, activeShift tersimpan & disync', async () => {
    const res = await useShiftStore.getState().openShift('u1', 'Kasir 1', 200000);
    expect(res.ok).toBe(true);
    const s = useShiftStore.getState();
    expect(s.activeShift).not.toBeNull();
    expect(s.activeShift!.userName).toBe('Kasir 1');
    expect(s.activeShift!.openingCash).toBe(200000);
    expect(s.shifts.some((x) => x.id === s.activeShift!.id)).toBe(true);
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  it('openShift saat sudah ada shift terbuka LOKAL → ditolak, shift lama dikembalikan', async () => {
    const existing = openShift('s1', 'Kasir 1', '2026-08-18T08:00:00.000Z');
    useShiftStore.setState({ shifts: [existing], activeShift: existing });

    const res = await useShiftStore.getState().openShift('u2', 'Kasir 2', 150000);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('shift-exists');
      expect(res.existing.id).toBe('s1');
    }
    // Tidak ada shift baru dibuat / disync
    expect(mockedSync).not.toHaveBeenCalled();
    expect(useShiftStore.getState().shifts.filter((s) => s.status === 'open')).toHaveLength(1);
  });

  it('openShift saat ada shift terbuka di CLOUD (device lain) → ditolak (anti 2 shift aktif)', async () => {
    mockedFetch.mockResolvedValue([openShift('s-cloud', 'Kasir 1', '2026-08-18T07:00:00.000Z')]);

    const res = await useShiftStore.getState().openShift('u2', 'Kasir 2', 150000);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('shift-exists');
      expect(res.existing.id).toBe('s-cloud');
    }
    expect(mockedSync).not.toHaveBeenCalled();
    expect(useShiftStore.getState().activeShift).toBeNull();
  });

  it('openShift saat OFFLINE (fetch gagal) → diizinkan (tidak bisa verifikasi, 1 shift per device)', async () => {
    mockedFetch.mockRejectedValue(new Error('offline'));
    const res = await useShiftStore.getState().openShift('u1', 'Kasir 1', 200000);
    expect(res.ok).toBe(true);
    expect(useShiftStore.getState().activeShift).not.toBeNull();
  });

  it('resumeExistingShift → shift diadopsi sebagai activeShift tanpa input modal kas ulang', () => {
    const existing = openShift('s1', 'Kasir 1', '2026-08-18T08:00:00.000Z');
    useShiftStore.getState().resumeExistingShift(existing);
    const s = useShiftStore.getState();
    expect(s.activeShift?.id).toBe('s1');
    expect(s.shifts.some((x) => x.id === 's1')).toBe(true);
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it('loadFromCloud: beberapa shift terbuka → aktifkan yang PALING AWAL (siapa pun kasirnya)', async () => {
    const early = openShift('s-early', 'Kasir 1', '2026-08-18T06:00:00.000Z');
    const late = openShift('s-late', 'Kasir 2', '2026-08-18T09:00:00.000Z');
    mockedFetch.mockResolvedValue([late, early]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await useShiftStore.getState().loadFromCloud();
    expect(useShiftStore.getState().activeShift?.id).toBe('s-early');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('loadFromCloud: shift terbuka milik kasir lain (tanpa duplikat) → diadopsi', async () => {
    const other = openShift('s-other', 'Kasir 2', '2026-08-18T06:00:00.000Z');
    mockedFetch.mockResolvedValue([other]);
    await useShiftStore.getState().loadFromCloud();
    expect(useShiftStore.getState().activeShift?.id).toBe('s-other');
  });

  it('loadFromCloud: activeShift lokal ditutup di cloud → activeShift null', async () => {
    const local = openShift('s1', 'Kasir 1', '2026-08-18T06:00:00.000Z');
    useShiftStore.setState({ shifts: [local], activeShift: local });
    mockedFetch.mockResolvedValue([
      { ...local, status: 'closed', closedAt: '2026-08-18T12:00:00.000Z' } as CashierShift,
    ]);
    await useShiftStore.getState().loadFromCloud();
    expect(useShiftStore.getState().activeShift).toBeNull();
  });

  it('loadFromCloud: tidak ada shift terbuka di cloud → activeShift tetap null', async () => {
    const closed = { ...openShift('s1', 'Kasir 1', '2026-08-18T06:00:00.000Z'), status: 'closed' as const, closedAt: '2026-08-18T12:00:00.000Z' };
    mockedFetch.mockResolvedValue([closed]);
    await useShiftStore.getState().loadFromCloud();
    expect(useShiftStore.getState().activeShift).toBeNull();
  });
});
