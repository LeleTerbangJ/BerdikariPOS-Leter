// ============================================================
// v4.10 R-B1/R-B3 — Rencana tombol sambungkan pada banner printer (murni)
//
// R-B1: batasi jumlah tombol per-printer (≤ RECONNECT_BUTTON_CAP = 3) dan
//       tampilkan fallback "Sambungkan Semua" bila lebih banyak printer offline
//       — mencegah banner melebar pada konfigurasi >3 printer Bluetooth.
// R-B3: disabled PER-ID — hanya tombol printer yang sedang menghubungkan yang
//       nonaktif; printer lain tetap bisa diklik (kasir tidak menunggu satu
//       printer selesai untuk mengklik berikutnya). Selama "Sambungkan Semua"
//       berjalan, semua tombol nonaktif (picker Bluetooth satu pada satu waktu).
// ============================================================

/** Jumlah maksimal tombol per-printer yang dirender sebelum fallback massal. */
export const RECONNECT_BUTTON_CAP = 3;

export interface ReconnectButtonPlan {
  /** Tombol individual yang dirender (maks `cap`, urutan offlinePrinters). */
  buttons: Array<{ id: string; name: string; disabled: boolean }>;
  /** True bila jumlah offline > cap → fallback "Sambungkan Semua" perlu dirender. */
  showAllButton: boolean;
  /** Total printer offline (label fallback "Sambungkan Semua (N)"). */
  allCount: number;
  /** Fallback nonaktif saat ada reconnect (tunggal atau massal) berjalan. */
  allDisabled: boolean;
}

export function buildReconnectButtonPlan(
  offlinePrinters: Array<{ id: string; name: string }>,
  reconnectingId: string | null,
  reconnectingAll: boolean,
  cap: number = RECONNECT_BUTTON_CAP
): ReconnectButtonPlan {
  const buttons = offlinePrinters.slice(0, cap).map((p) => ({
    id: p.id,
    name: p.name,
    // R-B3: per-id — tombol lain tetap aktif selama printer lain menghubungkan.
    disabled: reconnectingAll || reconnectingId === p.id,
  }));
  return {
    buttons,
    showAllButton: offlinePrinters.length > cap,
    allCount: offlinePrinters.length,
    allDisabled: reconnectingId !== null || reconnectingAll,
  };
}