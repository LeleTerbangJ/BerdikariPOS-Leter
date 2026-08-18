import type { CashierShift, Transaction, CashMovement } from '../types';

export interface ShiftStats {
  totalSales: number;
  totalTx: number;
  expectedCash: number;
  cashIn: number;
  cashOut: number;
  cashSales: number;
  qrisSales: number;
  transferSales: number;
}

export const EMPTY_SHIFT_STATS: ShiftStats = {
  totalSales: 0,
  totalTx: 0,
  expectedCash: 0,
  cashIn: 0,
  cashOut: 0,
  cashSales: 0,
  qrisSales: 0,
  transferSales: 0,
};

/**
 * v4.7 TO DO 18.3 — Expected cash tutup shift dihitung dari SEMUA transaksi Selesai
 * tersinkron dalam window shift (1 shift aktif per outlet → laci dipakai bersama),
 * BUKAN hanya transaksi lokal device / kasir tertentu.
 *
 * Aturan:
 * - Transaksi: txStatus === 'Selesai', bukan sub-bill split (sudah terhitung di induk),
 *   dan date >= openedAt shift.
 * - Semua kasir dihitung (tidak ada filter cashierId) — konsisten dengan model 1 shift
 *   per outlet di shiftStore (openShift guard + restore shift terbuka paling awal).
 * - Kas Masuk/Keluar: dipilih via shiftId bila tersedia, fallback window waktu (semua
 *   kasir — laci bersama), sama seperti perilaku lama.
 * - expectedCash = openingCash + cashSales + cashIn - cashOut.
 */
export function computeShiftStats(
  activeShift: CashierShift,
  transactions: Transaction[],
  movements: CashMovement[]
): ShiftStats {
  const openedAtMs = new Date(activeShift.openedAt).getTime();

  const shiftTx = transactions.filter(
    (t) =>
      t.txStatus === 'Selesai' &&
      !t.splitParentId &&
      new Date(t.date).getTime() >= openedAtMs
  );

  const totalSales = shiftTx.reduce((a, t) => a + t.totalAmount, 0);

  const cashSales = shiftTx
    .filter((t) => t.paymentMethod === 'Cash')
    .reduce((a, t) => a + t.totalAmount, 0);
  const qrisSales = shiftTx
    .filter((t) => t.paymentMethod === 'QRIS')
    .reduce((a, t) => a + t.totalAmount, 0);
  const transferSales = shiftTx
    .filter((t) => t.paymentMethod === 'Transfer')
    .reduce((a, t) => a + t.totalAmount, 0);

  // Kas Masuk & Kas Keluar selama shift — shiftId match lebih diutamakan;
  // fallback: window waktu (semua kasir, karena laci fisik dipakai bersama).
  const shiftMovements = movements.filter((m) => {
    if (m.shiftId && m.shiftId === activeShift.id) return true;
    return new Date(m.date).getTime() >= openedAtMs - 60000;
  });
  const cashIn = shiftMovements
    .filter((m) => m.type === 'in')
    .reduce((a, m) => a + m.amount, 0);
  const cashOut = shiftMovements
    .filter((m) => m.type === 'out')
    .reduce((a, m) => a + m.amount, 0);

  const expectedCash = activeShift.openingCash + cashSales + cashIn - cashOut;

  return {
    totalSales,
    totalTx: shiftTx.length,
    expectedCash,
    cashIn,
    cashOut,
    cashSales,
    qrisSales,
    transferSales,
  };
}
