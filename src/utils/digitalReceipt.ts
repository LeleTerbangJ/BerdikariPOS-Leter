/**
 * Digital Receipt (Struk Digital) — v4.7 TO DO 11.2 (P0.4)
 *
 * Murni & tanpa efek samping (bisa diuji tanpa browser):
 * - buildReceiptText  : struk dalam format teks polos (mirip struk thermal) untuk WA/email
 * - normalizePhone    : normalisasi nomor HP Indonesia untuk wa.me
 * - buildWhatsAppUrl  : deep-link https://wa.me/...?text=<struk>
 * - buildMailtoUrl    : mailto:...?subject&body=<struk>
 * - findCustomerContact: ambil kontak (phone/email) pelanggan dari store CRM berdasarkan tx.customerId
 */

import { formatRupiah } from './format';
import type { AppSettings, Customer, Transaction } from '../types';
import type { ReceiptData } from './printer';

// ============================================================
// NORMALISASI NOMOR (untuk wa.me)
// ============================================================

/**
 * Normalisasi nomor HP ke format internasional tanpa awalan (hanya digit).
 * - "0812-3456-7890" / "+62 812 3456 7890" -> "6281234567890"
 * - Awalan "0" diubah ke "62" (Indonesia)
 * - Mengembalikan '' jika tidak valid (kurang dari 9 digit atau lebih dari 15)
 */
export function normalizePhone(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return '';
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  return digits;
}

// ============================================================
// PEMBANGUN URL WA / MAILTO
// ============================================================

/**
 * Deep-link WhatsApp dengan isi pesan. Mengembalikan null jika nomor tidak valid.
 * Nomor dipisahkan dengan koma untuk multi-penerima tidak didukung — satu penerima saja.
 */
export function buildWhatsAppUrl(phone: string, text: string): string | null {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/**
 * Link mailto dengan subject & body ter-encode. Mengembalikan null jika email kosong/tidak valid.
 */
export function buildMailtoUrl(email: string, subject: string, body: string): string | null {
  const clean = (email || '').trim();
  if (!clean || !clean.includes('@')) return null;
  return `mailto:${clean}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ============================================================
// STRUK TEKS POLOS
// ============================================================

function padLeftRight(left: string, right: string, width: number): string {
  const space = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

function dashLine(width = 32): string {
  return '-'.repeat(width);
}

function formatReceiptDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${mins}`;
}

function itemLine(item: ReceiptData['items'][number]): string[] {
  const lines: string[] = [];
  const addonStr = item.addons.length > 0 ? ` +${item.addons.map((a) => (a.price > 0 ? a.name : a.name + '(Gratis)')).join(',')}` : '';
  const sugarStr = item.showSugarLevel !== false ? `/${item.sugar}` : '';
  const tempStr = item.showTemperature !== false ? item.temperature : '';
  const detailStr = `${tempStr}${sugarStr}${addonStr}`.trim();

  const bundleTag = item.isBundle ? ' (Paket)' : '';
  lines.push(`${item.name}${bundleTag}`);
  if (detailStr) lines.push(`  ${detailStr}`);
  const unitPrice = item.basePrice + item.addons.reduce((a, b) => a + b.price, 0);
  lines.push(padLeftRight(`  ${item.quantity}x ${formatRupiah(unitPrice)}`, formatRupiah(item.subtotal), 32));
  // v4.7 TO DO 22.2: tampilkan diskon per item di struk digital
  const itemDisc = item.itemDiscount || 0;
  if (itemDisc > 0) {
    lines.push(padLeftRight('  Diskon item', `-${formatRupiah(itemDisc)}`, 32));
  }
  return lines;
}

/**
 * Struk dalam bentuk teks polos (monospace-friendly) — isi pesan WhatsApp / body email.
 * Layout mengikuti struk thermal: header toko, info transaksi, daftar item, total, pembayaran, footer.
 */
export function buildReceiptText(data: ReceiptData): string {
  const lines: string[] = [];

  lines.push(data.storeName.toUpperCase());
  if (data.storeAddress) lines.push(data.storeAddress);
  if (data.receiptHeader) lines.push(data.receiptHeader);
  if (data.isReprint) lines.push('*** CETAK ULANG ***');
  lines.push(dashLine());

  // Info transaksi
  const orderLine = data.orderType ? data.orderType.toUpperCase() : '';
  const tableStr = data.tableNumber ? `MEJA ${data.tableNumber}` : '';
  lines.push(padLeftRight(`No: #${data.queueNumber}`, [orderLine, tableStr].filter(Boolean).join(' '), 32));
  lines.push(`Tgl: ${formatReceiptDate(data.date)}`);
  lines.push(`Kasir: ${data.cashierName}`);
  if (data.customerName) lines.push(`Pelanggan: ${data.customerName}`);
  lines.push(dashLine());

  // Item
  for (const item of data.items) {
    lines.push(...itemLine(item));
  }
  lines.push(dashLine());

  // Total
  lines.push(padLeftRight('Subtotal', formatRupiah(data.subtotal), 32));
  if (data.discount > 0) lines.push(padLeftRight('Diskon', `-${formatRupiah(data.discount)}`, 32));
  // v4.7 TO DO 12.2.7 (P-A7): nama promo/voucher di struk digital (WA/email)
  if (data.promoName) lines.push(`Promo: ${data.promoName}${data.promoCode ? ` (${data.promoCode})` : ''}`);
  if (data.tax && data.tax > 0) lines.push(padLeftRight('Pajak', formatRupiah(data.tax), 32));
  lines.push(padLeftRight('TOTAL', formatRupiah(data.total), 32));
  lines.push(dashLine());

  // Pembayaran
  lines.push(padLeftRight(`Bayar (${data.paymentMethod})`, formatRupiah(data.cashReceived ?? data.total), 32));
  if (data.paymentMethod === 'Cash' && data.change !== undefined) {
    lines.push(padLeftRight('Kembali', formatRupiah(data.change), 32));
  }
  lines.push(dashLine());

  lines.push(data.receiptFooter || 'Terima kasih atas kunjungan Anda!');
  lines.push('');

  return lines.join('\n');
}

// ============================================================
// KONTAK PELANGGAN
// ============================================================

/**
 * Ambil kontak pelanggan (phone/email) dari daftar CRM berdasarkan customerId pada transaksi.
 * Mengembalikan objek kosong jika pelanggan tidak terdaftar / tidak punya kontak.
 */
export function findCustomerContact(
  tx: Transaction,
  customers: Customer[]
): { phone?: string; email?: string } {
  if (!tx.customerId) return {};
  const cust = customers.find((c) => c.id === tx.customerId);
  if (!cust) return {};
  return {
    phone: cust.phone || undefined,
    email: cust.email || undefined,
  };
}

// ============================================================
// AUTO-KIRIM PASCA-CHECKOUT (TO DO 11.2 / P0.4 — Settings)
// ============================================================

/**
 * Keputusan murni: apakah struk digital otomatis dikirim ke WhatsApp pelanggan setelah checkout?
 * Mengembalikan { phone } jika fitur aktif DI SETTINGS dan pelanggan punya nomor HP valid;
 * null jika nonaktif / tanpa pelanggan / nomor tidak valid (POS pre-open window hanya saat non-null).
 */
export function autoSendReceiptTarget(
  settings: AppSettings,
  customer?: Customer | null
): { phone: string } | null {
  if (!settings.autoSendDigitalReceipt) return null;
  const phone = customer?.phone;
  if (!phone) return null;
  if (!normalizePhone(phone)) return null;
  return { phone };
}
