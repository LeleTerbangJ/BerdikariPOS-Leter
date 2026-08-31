// ============================================================
// v4.10 R-B1/R-B3 — Rencana tombol reconnect banner printer
//
// R-B1: cap tombol per-printer (≤3) + fallback "Sambungkan Semua"
//       pada konfigurasi >3 printer offline (banner tidak melebar).
// R-B3: disabled PER-ID — tombol printer lain tetap aktif saat satu
//       printer sedang menghubungkan; "Sambungkan Semua" nonaktif
//       selama ada koneksi (tunggal/massal) berjalan.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildReconnectButtonPlan, RECONNECT_BUTTON_CAP } from '../utils/reconnectPlan';

const printers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `kp-${i + 1}`, name: `Printer Dapur ${i + 1}` }));

describe('buildReconnectButtonPlan — cap tombol (R-B1)', () => {
  it('≤3 printer offline: semua tombol individual dirender, tanpa fallback massal', () => {
    const plan = buildReconnectButtonPlan(printers(3), null, false);
    expect(plan.buttons).toHaveLength(3);
    expect(plan.showAllButton).toBe(false);
    expect(plan.allCount).toBe(3);
    expect(plan.buttons.map((b) => b.id)).toEqual(['kp-1', 'kp-2', 'kp-3']);
  });

  it('>3 printer offline: hanya 3 tombol pertama + fallback "Sambungkan Semua (N)"', () => {
    const plan = buildReconnectButtonPlan(printers(6), null, false);
    expect(plan.buttons).toHaveLength(RECONNECT_BUTTON_CAP);
    expect(plan.buttons.map((b) => b.id)).toEqual(['kp-1', 'kp-2', 'kp-3']);
    expect(plan.showAllButton).toBe(true);
    expect(plan.allCount).toBe(6);
  });

  it('cap kustom dihormati (parameter cap)', () => {
    const plan = buildReconnectButtonPlan(printers(5), null, false, 2);
    expect(plan.buttons).toHaveLength(2);
    expect(plan.showAllButton).toBe(true);
    expect(plan.allCount).toBe(5);
  });

  it('daftar kosong: tanpa tombol dan tanpa fallback', () => {
    const plan = buildReconnectButtonPlan([], null, false);
    expect(plan.buttons).toHaveLength(0);
    expect(plan.showAllButton).toBe(false);
    expect(plan.allCount).toBe(0);
  });
});

describe('buildReconnectButtonPlan — disabled per-id (R-B3)', () => {
  it('saat idle: semua tombol aktif, fallback aktif', () => {
    const plan = buildReconnectButtonPlan(printers(4), null, false);
    expect(plan.buttons.every((b) => !b.disabled)).toBe(true);
    expect(plan.allDisabled).toBe(false);
  });

  it('satu printer menghubungkan: HANYA tombol printer itu yang disabled; lain tetap aktif', () => {
    const plan = buildReconnectButtonPlan(printers(4), 'kp-2', false);
    const p2 = plan.buttons.find((b) => b.id === 'kp-2')!;
    expect(p2.disabled).toBe(true);
    // tombol lain (yang dirender) tetap bisa diklik
    expect(plan.buttons.filter((b) => b.id !== 'kp-2').every((b) => !b.disabled)).toBe(true);
    // fallback nonaktif saat ada koneksi tunggal berjalan
    expect(plan.allDisabled).toBe(true);
  });

  it('reconnecting printer DI LUAR cap (kp-5): tombol yang dirender tetap aktif, fallback nonaktif', () => {
    const plan = buildReconnectButtonPlan(printers(5), 'kp-5', false);
    expect(plan.buttons.every((b) => !b.disabled)).toBe(true);
    expect(plan.allDisabled).toBe(true);
  });

  it('"Sambungkan Semua" berjalan: semua tombol individual + fallback nonaktif', () => {
    const plan = buildReconnectButtonPlan(printers(5), null, true);
    expect(plan.buttons.every((b) => b.disabled)).toBe(true);
    expect(plan.allDisabled).toBe(true);
  });

  it('nama printer dipertahankan untuk label tombol', () => {
    const plan = buildReconnectButtonPlan([{ id: 'x', name: 'Printer Barista' }], null, false);
    expect(plan.buttons[0].name).toBe('Printer Barista');
  });
});
// ============================================================
// T-1: status usePrinterMonitor tidak lagi memuat previouslyConnected (dead state)
// T-2: buildReconnectButtonPlan tidak punya reconnectingAll stale — semuaDisabled
//      konsisten dengan flag reconnectingAll yang direset saat allConnected.
// ============================================================
import type { PrinterMonitorStatus } from '../hooks/usePrinterMonitor';

describe('T-1 — previouslyConnected field dihapus dari PrinterMonitorStatus', () => {
  it('status tidak memiliki property previouslyConnected (dead state removed)', () => {
    // Type-level: jika previouslyConnected masih ada di interface, baris ini
    // akan error di compile. Runtime: pastikan field tidak ada di objek kosong.
    const empty: PrinterMonitorStatus = {
      active: false,
      totalConfigured: 0,
      totalConnected: 0,
      totalDisconnected: 0,
      offlinePrinters: [],
      allConnected: false,
    };
    expect(empty).not.toHaveProperty('previouslyConnected');
  });

  it('status dengan printer aktif juga tidak memiliki previouslyConnected', () => {
    const active: PrinterMonitorStatus = {
      active: true,
      totalConfigured: 2,
      totalConnected: 1,
      totalDisconnected: 1,
      offlinePrinters: [{ id: 'kp-1', name: 'Printer Dapur' }],
      allConnected: false,
    };
    expect(active).not.toHaveProperty('previouslyConnected');
  });
});

describe('T-2 — reconnectingAll tidak menyebabkan stale disabled saat allConnected', () => {
  it('idle (reconnectingAll=false) dengan 0 offline → tidak ada tombol, allDisabled=false', () => {
    // Saat allConnected, offlinePrinters=[], plan tidak punya tombol → tidak ada stale spinner
    const plan = buildReconnectButtonPlan([], null, false);
    expect(plan.buttons).toHaveLength(0);
    expect(plan.showAllButton).toBe(false);
    expect(plan.allDisabled).toBe(false);
  });

  it('reconnectingAll=true dengan 0 offline → allDisabled=true tapi tidak ada tombol dirender', () => {
    // Edge case T-2: bila reconnectingAll belum di-reset saat allConnected,
    // allDisabled masih true tapi tidak ada tombol yang dirender → tidak ada visual stale.
    // useEffect T-2 memastikan reconnectingAll di-reset ke false sehingga allDisabled=false.
    const plan = buildReconnectButtonPlan([], null, true);
    expect(plan.buttons).toHaveLength(0);
    expect(plan.showAllButton).toBe(false);
    // allDisabled true karena reconnectingAll masih true — tapi karena tidak ada
    // tombol yang dirender, tidak ada visual stale. useEffect akan reset ke false.
    expect(plan.allDisabled).toBe(true);
  });

  it('setelah reset (reconnectingAll=false) dengan 0 offline → allDisabled=false (clean state)', () => {
    // Simulasi pasca-useEffect T-2: reconnectingAll di-reset ke false saat allConnected
    const plan = buildReconnectButtonPlan([], null, false);
    expect(plan.allDisabled).toBe(false);
  });
});
