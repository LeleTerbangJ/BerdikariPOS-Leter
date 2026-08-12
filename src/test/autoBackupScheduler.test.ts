import { describe, it, expect } from 'vitest';
import { isAutoBackupDue } from '../lib/autoBackupScheduler';
import type { AutoBackupConfig } from '../store/backupStore';

// ============================================================
// TO DO 7.6 — Scheduler auto backup: logika murni isAutoBackupDue
// ============================================================

const daily = { frequency: 'Daily' as const, targetTime: '23:00' };
const weekly = { frequency: 'Weekly' as const, targetTime: '23:00' };
const off = { frequency: 'OFF' as const, targetTime: '23:00' };

describe('isAutoBackupDue — frequency OFF', () => {
  it('OFF → tidak pernah due, apa pun kondisinya', () => {
    expect(isAutoBackupDue(off, undefined, new Date(2026, 7, 12, 23, 59))).toBe(false);
    expect(isAutoBackupDue(off, '2020-01-01T00:00:00Z', new Date(2026, 7, 12, 23, 59))).toBe(false);
  });
});

describe('isAutoBackupDue — Daily', () => {
  it('belum mencapai targetTime (22:59) → tidak due', () => {
    expect(isAutoBackupDue(daily, undefined, new Date(2026, 7, 12, 22, 59))).toBe(false);
  });

  it('belum pernah jalan + sudah lewat targetTime → due', () => {
    expect(isAutoBackupDue(daily, undefined, new Date(2026, 7, 12, 23, 1))).toBe(true);
  });

  it('sudah jalan HARI INI → tidak due (hindari eksekusi ganda tiap menit)', () => {
    const last = new Date(2026, 7, 12, 23, 5).toISOString();
    expect(isAutoBackupDue(daily, last, new Date(2026, 7, 12, 23, 30))).toBe(false);
  });

  it('terakhir jalan KEMARIN → due (hari baru)', () => {
    const last = new Date(2026, 7, 11, 23, 5).toISOString();
    expect(isAutoBackupDue(daily, last, new Date(2026, 7, 12, 23, 30))).toBe(true);
  });

  it('lastRunAt tidak valid → due (safety: jangan pernah terjebak tidak jalan)', () => {
    expect(isAutoBackupDue(daily, 'bukan-tanggal', new Date(2026, 7, 12, 23, 30))).toBe(true);
  });
});

describe('isAutoBackupDue — Weekly', () => {
  // Minggu 9 Agt 2026 = awal minggu; Rabu 12 Agt di minggu yang sama
  it('belum pernah jalan minggu ini → due', () => {
    expect(isAutoBackupDue(weekly, undefined, new Date(2026, 7, 12, 23, 30))).toBe(true);
  });

  it('sudah jalan MINGGU INI (Senin) → tidak due', () => {
    const last = new Date(2026, 7, 10, 23, 5).toISOString(); // Senin
    expect(isAutoBackupDue(weekly, last, new Date(2026, 7, 12, 23, 30))).toBe(false);
  });

  it('terakhir jalan MINGGU LALU → due', () => {
    const last = new Date(2026, 7, 5, 23, 5).toISOString(); // Rabu pekan lalu
    expect(isAutoBackupDue(weekly, last, new Date(2026, 7, 12, 23, 30))).toBe(true);
  });

  it('lastRun tepat di hari Minggu awal minggu ini → tetap satu minggu → tidak due', () => {
    const last = new Date(2026, 7, 9, 23, 30).toISOString(); // Minggu
    expect(isAutoBackupDue(weekly, last, new Date(2026, 7, 12, 23, 30))).toBe(false);
  });
});

describe('isAutoBackupDue — targetTime default & edge', () => {
  it('tanpa targetTime → default 23:00', () => {
    const cfg = { frequency: 'Daily' as const, targetTime: undefined };
    expect(isAutoBackupDue(cfg, undefined, new Date(2026, 7, 12, 22, 59))).toBe(false);
    expect(isAutoBackupDue(cfg, undefined, new Date(2026, 7, 12, 23, 0))).toBe(true);
  });

  it('targetTime tidak valid → fallback aman 23:00', () => {
    const cfg = { frequency: 'Daily' as const, targetTime: 'abc' as any };
    expect(isAutoBackupDue(cfg, undefined, new Date(2026, 7, 12, 23, 1))).toBe(true);
  });
});
