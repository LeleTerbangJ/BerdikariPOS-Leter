import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatRupiah } from './format';

interface PDFReportOptions {
  title: string;
  subtitle?: string;
  storeName: string;
  period?: string;
}

function createPDF(options: PDFReportOptions): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(options.storeName, pageWidth / 2, 20, { align: 'center' });

  doc.setFontSize(14);
  doc.text(options.title, pageWidth / 2, 30, { align: 'center' });

  if (options.subtitle || options.period) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(options.subtitle || `Periode: ${options.period}`, pageWidth / 2, 38, { align: 'center' });
  }

  doc.setFontSize(8);
  doc.text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, pageWidth / 2, 44, { align: 'center' });

  return doc;
}

export function exportPnlPDF(data: {
  storeName: string;
  period: string;
  totalRevenue: number;
  totalHPP: number;
  totalDiscount: number;
  totalTax: number; // GAP-3 fix: Pajak
  netRevenue: number; // GAP-3 fix: Pendapatan Bersih
  grossProfit: number;
  totalOpnameLoss?: number; // BUG-02 fix: Stock Opname Loss
  netProfit?: number; // BUG-02 fix: Net Profit after Opname Loss
  profitMargin: number;
  txCount: number;
  avgTransaction: number;
  paymentBreakdown: { Cash: number; QRIS: number; Transfer: number };
  orderTypeBreakdown?: { 'Dine In': number; 'Take Away': number };
  categorySales: [string, { revenue: number; qty: number }][];
}) {
  const doc = createPDF({ title: 'Laporan Laba Rugi', storeName: data.storeName, period: data.period });

  const opnameLoss = data.totalOpnameLoss || 0;
  const netProf = data.netProfit !== undefined ? data.netProfit : data.grossProfit - opnameLoss;

  // P&L Table
  autoTable(doc, {
    startY: 50,
    head: [['Keterangan', 'Jumlah']],
    body: [
      ['Total Pendapatan Kotor (Gross)', formatRupiah(data.totalRevenue)],
      ['Diskon yang Diberikan', `(${formatRupiah(data.totalDiscount)})`],
      ['Pendapatan Bersih (Net Sales)', formatRupiah(data.netRevenue)],
      ['Pajak Terkumpul (Tax)', `+${formatRupiah(data.totalTax)}`],
      ['Harga Pokok Penjualan (HPP)', `(${formatRupiah(data.totalHPP)})`],
      ['Laba Kotor', formatRupiah(data.grossProfit)],
      ['Kerugian Stock Opname (Bahan Basi/Rusak)', `(${formatRupiah(opnameLoss)})`],
      ['Laba Bersih Operasional (Net Profit)', formatRupiah(netProf)],
      ['', ''],
      ['Jumlah Transaksi', String(data.txCount)],
      ['Rata-rata per Transaksi', formatRupiah(data.avgTransaction)],
      ['Margin', `${data.profitMargin.toFixed(1)}%`],
    ],
    theme: 'grid',
    headStyles: { fillColor: [184, 95, 33] },
  });

  // Payment breakdown
  const y1 = (doc as any).lastAutoTable.finalY + 10;
  autoTable(doc, {
    startY: y1,
    head: [['Metode Pembayaran', 'Jumlah']],
    body: [
      ['Cash', formatRupiah(data.paymentBreakdown.Cash)],
      ['QRIS', formatRupiah(data.paymentBreakdown.QRIS)],
      ['Transfer', formatRupiah(data.paymentBreakdown.Transfer)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [59, 130, 246] },
  });

  // Order Type breakdown
  if (data.orderTypeBreakdown) {
    const yOrderType = (doc as any).lastAutoTable.finalY + 10;
    autoTable(doc, {
      startY: yOrderType,
      head: [['Tipe Pesanan', 'Jumlah Pesanan']],
      body: [
        ['Dine In', `${data.orderTypeBreakdown['Dine In']} Pesanan`],
        ['Take Away', `${data.orderTypeBreakdown['Take Away']} Pesanan`],
      ],
      theme: 'grid',
      headStyles: { fillColor: [6, 182, 212] },
    });
  }

  // Category sales
  if (data.categorySales.length > 0) {
    const y2 = (doc as any).lastAutoTable.finalY + 10;
    autoTable(doc, {
      startY: y2,
      head: [['Kategori', 'Revenue', 'Qty']],
      body: data.categorySales.map(([cat, d]) => [cat, formatRupiah(d.revenue), `${d.qty}x`]),
      theme: 'grid',
      headStyles: { fillColor: [34, 197, 94] },
    });
  }

  doc.save(`laporan-laba-rugi-${data.period.replace(/\s/g, '-')}.pdf`);
}

export function exportTransactionsPDF(data: {
  storeName: string;
  period: string;
  transactions: { queue: string; date: string; cashier: string; customer: string; items: string; tax: string; total: string; method: string; status: string }[];
  totalRevenue: number;
  txCount: number;
}) {
  const doc = createPDF({ title: 'Laporan Transaksi', storeName: data.storeName, period: data.period });

  doc.setFontSize(10);
  doc.text(`Total: ${data.txCount} transaksi | Revenue: ${formatRupiah(data.totalRevenue)}`, 14, 52);

  autoTable(doc, {
    startY: 58,
    head: [['No.', 'Tanggal', 'Kasir', 'Pelanggan', 'Pajak', 'Total', 'Metode', 'Status']],
    body: data.transactions.map((t) => [t.queue, t.date, t.cashier, t.customer, t.tax, t.total, t.method, t.status]),
    theme: 'grid',
    headStyles: { fillColor: [184, 95, 33] },
    styles: { fontSize: 7 },
  });

  doc.save(`laporan-transaksi-${data.period.replace(/\s/g, '-')}.pdf`);
}

export function exportInventoryPDF(data: {
  storeName: string;
  items: { name: string; stock: string; unit: string; minStock: string; cost: string; value: string; status: string }[];
  totalValue: number;
  lowStockCount: number;
}) {
  const doc = createPDF({ title: 'Laporan Stok Bahan Baku', storeName: data.storeName });

  doc.setFontSize(10);
  doc.text(`Nilai Inventaris: ${formatRupiah(data.totalValue)} | Stok Rendah: ${data.lowStockCount} item`, 14, 52);

  autoTable(doc, {
    startY: 58,
    head: [['Nama', 'Stok', 'Unit', 'Min.', 'Harga/Unit', 'Nilai', 'Status']],
    body: data.items.map((i) => [i.name, i.stock, i.unit, i.minStock, i.cost, i.value, i.status]),
    theme: 'grid',
    headStyles: { fillColor: [184, 95, 33] },
    styles: { fontSize: 8 },
  });

  doc.save('laporan-stok-bahan.pdf');
}

export function exportShiftPDF(data: {
  storeName: string;
  period: string;
  shifts: {
    name: string;
    txCount: string;
    revenue: string;
    avg: string;
    from: string;
    to: string;
    cashSales?: string;
    qrisSales?: string;
    transferSales?: string;
    cashIn?: string;
    cashOut?: string;
    diff?: string;
  }[];
}) {
  const doc = createPDF({ title: 'Laporan Shift Karyawan', storeName: data.storeName, period: data.period });

  autoTable(doc, {
    startY: 50,
    head: [['Kasir', 'Transaksi', 'Omset', 'Rata-rata', 'Tunai', 'QRIS', 'Transfer', 'Kas Masuk', 'Kas Keluar', 'Selisih Kas']],
    body: data.shifts.map((s) => [
      s.name,
      s.txCount,
      s.revenue,
      s.avg,
      s.cashSales || '-',
      s.qrisSales || '-',
      s.transferSales || '-',
      s.cashIn || '-',
      s.cashOut || '-',
      s.diff || 'Pas',
    ]),
    theme: 'grid',
    headStyles: { fillColor: [184, 95, 33] },
    styles: { fontSize: 7 },
  });

  doc.save(`laporan-shift-${data.period.replace(/\s/g, '-')}.pdf`);
}

export function exportCashPDF(data: {
  storeName: string;
  shifts: { cashier: string; open: string; close: string; opening: string; expected: string; actual: string; diff: string; sales: string; tx: string }[];
  cashMovements?: { date: string; cashier: string; type: string; category: string; amount: string; notes: string }[];
}) {
  const doc = createPDF({ title: 'Laporan Kas Kasir & Arus Kas', storeName: data.storeName });

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('1. Riwayat Shift Kasir', 14, 52);

  autoTable(doc, {
    startY: 56,
    head: [['Kasir', 'Buka', 'Tutup', 'Modal', 'Expected', 'Aktual', 'Selisih', 'Sales', 'Tx']],
    body: data.shifts.map((s) => [s.cashier, s.open, s.close, s.opening, s.expected, s.actual, s.diff, s.sales, s.tx]),
    theme: 'grid',
    headStyles: { fillColor: [184, 95, 33] },
    styles: { fontSize: 7 },
  });

  if (data.cashMovements && data.cashMovements.length > 0) {
    const y2 = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('2. Riwayat Arus Kas (Kas Masuk & Kas Keluar)', 14, y2);

    autoTable(doc, {
      startY: y2 + 4,
      head: [['Tanggal', 'Kasir', 'Tipe', 'Kategori', 'Nominal', 'Catatan']],
      body: data.cashMovements.map((m) => [m.date, m.cashier, m.type, m.category, m.amount, m.notes]),
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246] },
      styles: { fontSize: 7 },
    });
  }

  doc.save('laporan-kas-kasir.pdf');
}
