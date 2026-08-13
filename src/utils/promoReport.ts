// ============================================================
// v4.7 TO DO 12.2.4 (P-A3): Laporan Performa Promo
// Helper MURNI (tanpa efek samping / store) — teruji di
// src/test/promoReport.test.ts
// ============================================================
import type { Transaction, Promo } from '../types';

/**
 * Transaksi yang layak masuk laporan performa promo:
 * - status 'Selesai' (bukan Cancel/Demo/Pending)
 * - bukan sub-bill hasil split bill (sudah dihitung di sesi/induk — hindari double accounting)
 * - belum di-refund (P0.2: pendapatan sudah dikembalikan)
 */
export function isPromoEligibleTx(tx: Transaction): boolean {
  if (tx.txStatus !== 'Selesai') return false;
  if (tx.splitParentId) return false;
  if (tx.refunded) return false;
  return true;
}

/**
 * Nama promo untuk transaksi:
 * 1. Snapshot tersimpan (tx.promoName) — paling akurat, tahan terhadap edit/hapus promo.
 * 2. Fallback lookup promo aktif (transaksi lama sebelum promoName disimpan).
 * 3. appliedPromoId tanpa lookup → "Promo (tidak ditemukan)" (promo sudah dihapus).
 */
export function resolvePromoName(tx: Transaction, promos?: Promo[]): string {
  if (tx.promoName) return tx.promoName;
  if (tx.appliedPromoId && promos) {
    const promo = promos.find((p) => p.id === tx.appliedPromoId);
    if (promo) return promo.name;
  }
  if (tx.appliedPromoId) return 'Promo (tidak ditemukan)';
  return 'Tanpa Promo';
}

export interface PromoDetailRow {
  transactionId: string;
  queueNumber: number;
  date: string;
  cashierName: string;
  customerName?: string;
  promoId?: string;
  promoName: string;
  promoAmount: number; // nominal diskon promo pada transaksi ini
  totalAmount: number;
}

export interface PromoPerformanceRow {
  promoId: string;      // appliedPromoId (atau key nama untuk fallback)
  promoName: string;
  usageCount: number;   // jumlah transaksi yang memakai promo
  totalDiscount: number; // total nominal diskon promo
  totalRevenue: number; // total nilai transaksi yang memakai promo
  avgDiscount: number;  // rata-rata diskon promo per transaksi
}

export interface PromoReportSummary {
  promoUsageCount: number; // jumlah transaksi memakai promo (bukan jumlah jenis promo)
  totalPromoDiscount: number;
  totalPromoRevenue: number;
  manualDiscount: number;  // diskon non-promo (manual/loyalty) pada transaksi TANPA promo
}

export function toPromoDetailRow(tx: Transaction, promos?: Promo[]): PromoDetailRow {
  return {
    transactionId: tx.id,
    queueNumber: tx.queueNumber,
    date: tx.date,
    cashierName: tx.cashierName,
    customerName: tx.customerName,
    promoId: tx.appliedPromoId,
    promoName: resolvePromoName(tx, promos),
    promoAmount: tx.promoAmount ?? 0,
    totalAmount: tx.totalAmount,
  };
}

/**
 * Agregasi performa promo dari daftar transaksi (biasanya sudah ter-filter tanggal).
 * - rows: ringkasan per promo, diurutkan total diskon tertinggi (lalu terbanyak dipakai)
 * - details: detail per transaksi ber-promo, terbaru dulu
 * - summary: angka global periode
 * Catatan jujur: transaksi lama (sebelum P-A3) memakai appliedPromoId tanpa promoAmount
 * → totalDiscount = 0 untuk data legacy (nominal tidak tersimpan).
 */
export function aggregatePromoPerformance(
  transactions: Transaction[],
  promos?: Promo[]
): { rows: PromoPerformanceRow[]; summary: PromoReportSummary; details: PromoDetailRow[] } {
  const eligible = transactions.filter(isPromoEligibleTx);
  const map = new Map<string, PromoPerformanceRow>();
  const details: PromoDetailRow[] = [];

  let promoUsageCount = 0;
  let totalPromoDiscount = 0;
  let totalPromoRevenue = 0;
  let manualDiscount = 0;

  for (const tx of eligible) {
    if (!tx.appliedPromoId) {
      // Diskon manual / loyalty tanpa promo — dicatat terpisah agar tidak tercampur
      manualDiscount += tx.discount || 0;
      continue;
    }

    const name = resolvePromoName(tx, promos);
    const key = tx.appliedPromoId;
    const amount = tx.promoAmount ?? 0;

    const existing = map.get(key);
    if (existing) {
      existing.usageCount += 1;
      existing.totalDiscount += amount;
      existing.totalRevenue += tx.totalAmount;
    } else {
      map.set(key, {
        promoId: key,
        promoName: name,
        usageCount: 1,
        totalDiscount: amount,
        totalRevenue: tx.totalAmount,
        avgDiscount: 0,
      });
    }

    details.push(toPromoDetailRow(tx, promos));
    promoUsageCount += 1;
    totalPromoDiscount += amount;
    totalPromoRevenue += tx.totalAmount;
  }

  const rows = Array.from(map.values())
    .map((r) => ({
      ...r,
      avgDiscount: r.usageCount > 0 ? Math.round(r.totalDiscount / r.usageCount) : 0,
    }))
    .sort(
      (a, b) =>
        b.totalDiscount - a.totalDiscount || b.usageCount - a.usageCount || a.promoName.localeCompare(b.promoName)
    );

  return {
    rows,
    summary: { promoUsageCount, totalPromoDiscount, totalPromoRevenue, manualDiscount },
    details: details.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
  };
}
