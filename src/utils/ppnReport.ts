/**
 * Laporan PPN (Pajak Pertambahan Nilai) — v4.7 TO DO 11.2 (P0.1)
 *
 * Logika murni untuk laporan pajak bulanan dari transaksi yang memakai pajak.
 * Semantik (selaras dengan POS.tsx & atomicTransactionEngine):
 *   - DPP (Dasar Pengenaan Pajak) = Net Sales = subtotal − discount
 *   - PPN = t.tax (dibulatkan dari DPP × persen saat checkout)
 *   - Total = DPP + PPN
 */

import type { Transaction } from '../types';

export interface PpnTransactionRow {
  queueNumber: number;
  date: string; // ISO
  cashierName: string;
  dpp: number; // Dasar Pengenaan Pajak (net sales)
  ppn: number; // PPN = tax
  total: number; // totalAmount
}

export interface PpnDayRow {
  dateKey: string; // YYYY-MM-DD
  label: string; // format id-ID
  txCount: number;
  dpp: number;
  ppn: number;
}

export interface PpnSummary {
  totalDpp: number;
  totalPpn: number;
  taxableCount: number; // transaksi kena pajak (tax > 0)
  exemptCount: number; // transaksi non-pajak dalam periode
}

/** Apakah transaksi kena pajak (ada nominal PPN tercatat). */
export function isTaxableTransaction(t: Transaction): boolean {
  return (t.tax ?? 0) > 0;
}

/** Baris detail PPN satu transaksi. */
export function toPpnRow(t: Transaction): PpnTransactionRow {
  return {
    queueNumber: t.queueNumber,
    date: t.date,
    cashierName: t.cashierName,
    dpp: Math.max(0, t.subtotal - t.discount),
    ppn: t.tax || 0,
    total: t.totalAmount,
  };
}

/** Ringkasan PPN untuk satu periode (input sudah difilter Selesai + non-split). */
export function summarizePpn(transactions: Transaction[]): PpnSummary {
  let totalDpp = 0;
  let totalPpn = 0;
  let taxableCount = 0;
  let exemptCount = 0;
  for (const t of transactions) {
    if (isTaxableTransaction(t)) {
      const r = toPpnRow(t);
      totalDpp += r.dpp;
      totalPpn += r.ppn;
      taxableCount++;
    } else {
      exemptCount++;
    }
  }
  return { totalDpp, totalPpn, taxableCount, exemptCount };
}

/** Rekap PPN per hari (ascending tanggal) — hanya transaksi kena pajak. */
export function aggregatePpnByDay(transactions: Transaction[]): PpnDayRow[] {
  const map = new Map<string, PpnDayRow>();
  for (const t of transactions) {
    if (!isTaxableTransaction(t)) continue;
    const d = new Date(t.date);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    let row = map.get(dateKey);
    if (!row) {
      row = { dateKey, label, txCount: 0, dpp: 0, ppn: 0 };
      map.set(dateKey, row);
    }
    const r = toPpnRow(t);
    row.txCount += 1;
    row.dpp += r.dpp;
    row.ppn += r.ppn;
  }
  return Array.from(map.values()).sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}
