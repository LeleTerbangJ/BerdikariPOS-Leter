import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  buildWhatsAppUrl,
  buildMailtoUrl,
  buildReceiptText,
  findCustomerContact,
  autoSendReceiptTarget,
} from '../utils/digitalReceipt';
import type { AppSettings, Customer, ReceiptData, Transaction } from '../types';

// ============================================================
// normalizePhone
// ============================================================

describe('normalizePhone (P0.4 — format nomor untuk wa.me)', () => {
  it('0812 prefix → 62812 (Indonesia)', () => {
    expect(normalizePhone('081234567890')).toBe('6281234567890');
  });

  it('+62 dengan pemisah/spasi → digit bersih', () => {
    expect(normalizePhone('+62 812-3456-7890')).toBe('6281234567890');
  });

  it('sudah 62 tanpa awalan → tetap', () => {
    expect(normalizePhone('6281234567890')).toBe('6281234567890');
  });

  it('kurang dari 9 digit → invalid (kosong)', () => {
    expect(normalizePhone('0812')).toBe('');
  });

  it('non-digit semua → invalid', () => {
    expect(normalizePhone('abc-def')).toBe('');
  });

  it('kosong / null-ish → invalid', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('   ')).toBe('');
  });
});

// ============================================================
// buildWhatsAppUrl & buildMailtoUrl
// ============================================================

describe('buildWhatsAppUrl (P0.4 — deep-link wa.me dengan struk)', () => {
  it('nomor valid → wa.me dengan teks ter-encode', () => {
    const url = buildWhatsAppUrl('081234567890', 'Struk #5\nTotal: Rp 10.000');
    expect(url).toBe('https://wa.me/6281234567890?text=Struk%20%235%0ATotal%3A%20Rp%2010.000');
  });

  it('nomor invalid → null', () => {
    expect(buildWhatsAppUrl('123', 'x')).toBeNull();
    expect(buildWhatsAppUrl('', 'x')).toBeNull();
  });
});

describe('buildMailtoUrl (P0.4 — email client dengan struk)', () => {
  it('email valid → mailto dengan subject & body ter-encode', () => {
    const url = buildMailtoUrl('a@b.com', 'Struk #5', 'Total: Rp 10.000');
    expect(url).toBe('mailto:a@b.com?subject=Struk%20%235&body=Total%3A%20Rp%2010.000');
  });

  it('email kosong / tanpa @ → null', () => {
    expect(buildMailtoUrl('', 's', 'b')).toBeNull();
    expect(buildMailtoUrl('abc', 's', 'b')).toBeNull();
  });
});

// ============================================================
// buildReceiptText
// ============================================================

function makeReceipt(): ReceiptData {
  return {
    storeName: 'Warung Berdikari',
    storeAddress: 'Jl. Merdeka No. 1',
    queueNumber: 7,
    date: '2026-08-12T10:30:00.000Z',
    cashierName: 'Kasir 1',
    customerName: 'Budi',
    items: [
      {
        lineId: 'l1',
        name: 'Es Teh Manis',
        quantity: 2,
        basePrice: 5000,
        subtotal: 10000,
        addons: [],
        sugar: 'Normal',
        temperature: 'Dingin',
        showSugarLevel: true,
        showTemperature: true,
        kitchenTarget: '',
      },
      {
        lineId: 'l2',
        name: 'Nasi Goreng',
        quantity: 1,
        basePrice: 20000,
        subtotal: 20000,
        addons: [{ id: 'a1', name: 'Telur', price: 3000 }],
        sugar: 'Normal',
        temperature: 'Panas',
        showSugarLevel: false,
        showTemperature: false,
        kitchenTarget: 'Makanan',
      },
    ],
    subtotal: 30000,
    discount: 2000,
    tax: 2800,
    total: 30800,
    paymentMethod: 'Cash',
    cashReceived: 50000,
    change: 19200,
    orderType: 'Dine In',
    tableNumber: 'Meja 05',
    receiptFooter: 'Terima kasih!',
  };
}

describe('buildReceiptText (P0.4 — struk teks polos untuk WA/email)', () => {
  it('memuat header toko, info transaksi, item, total & footer', () => {
    const text = buildReceiptText(makeReceipt());
    expect(text).toContain('WARUNG BERDIKARI');
    expect(text).toContain('Jl. Merdeka No. 1');
    expect(text).toContain('No: #7');
    expect(text).toContain('Kasir: Kasir 1');
    expect(text).toContain('Pelanggan: Budi');
    expect(text).toContain('Es Teh Manis');
    expect(text).toContain('Nasi Goreng');
    expect(text).toContain('2x Rp 5.000');
    expect(text).toContain('TOTAL');
    expect(text).toContain('Rp 30.800');
    expect(text).toContain('Terima kasih!');
  });

  it('menampilkan detail addon & suhu/gula pada item', () => {
    const text = buildReceiptText(makeReceipt());
    expect(text).toContain('Dingin/Normal');
    expect(text).toContain('+Telur');
  });

  it('add-on GRATIS (harga 0): nama tercetak dengan penanda (Gratis) & TIDAK menambah unit price', () => {
    const r = makeReceipt();
    r.items.push({
      lineId: 'l3',
      name: 'Ayam Geprek',
      quantity: 1,
      basePrice: 18000,
      subtotal: 18000, // hanya basePrice — add-on gratis +0
      addons: [
        { id: 'a3', name: 'Saus Sambal', price: 0 }, // gratis → penanda (Gratis)
        { id: 'a4', name: 'Saus Keju', price: 2000 }, // berbayar → tanpa penanda
      ],
      sugar: 'Normal',
      temperature: 'Panas',
      showSugarLevel: false,
      showTemperature: false,
      kitchenTarget: 'Makanan',
    });
    r.subtotal += 18000;
    r.total += 18000;
    const text = buildReceiptText(r);
    // Nama add-on gratis tercetak + penanda; add-on berbayar tanpa penanda
    expect(text).toContain('+Saus Sambal(Gratis),Saus Keju');
    // Unit price = basePrice + add-on berbayar saja (gratis +0, total tidak ter-inflasi)
    expect(text).toContain('1x Rp 20.000');
    expect(text).not.toContain('Rp 0');
  });

  it('menampilkan diskon, pajak, bayar & kembali', () => {
    const text = buildReceiptText(makeReceipt());
    expect(text).toContain('Diskon');
    expect(text).toContain('-Rp 2.000');
    expect(text).toContain('Pajak');
    expect(text).toContain('Rp 2.800');
    expect(text).toContain('Bayar (Cash)');
    expect(text).toContain('Rp 50.000');
    expect(text).toContain('Kembali');
    expect(text).toContain('Rp 19.200');
  });

  it('bukan HTML — tidak ada tag markup', () => {
    const text = buildReceiptText(makeReceipt());
    expect(text).not.toContain('<div');
    expect(text).not.toContain('<span');
    expect(text).not.toContain('</');
  });

  it('tanpa diskon/pajak → baris tidak muncul', () => {
    const r = makeReceipt();
    r.discount = 0;
    r.tax = 0;
    const text = buildReceiptText(r);
    expect(text).not.toContain('Diskon');
    expect(text).not.toContain('Pajak');
  });
});

// ============================================================
// findCustomerContact
// ============================================================

function makeTx(over: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    queueNumber: 42,
    date: '2026-08-10T10:00:00.000Z',
    items: [],
    subtotal: 100000,
    discount: 0,
    totalAmount: 100000,
    paymentMethod: 'Cash',
    kitchenStatus: 'Done',
    txStatus: 'Selesai',
    cashierId: 'u1',
    cashierName: 'Kasir 1',
    hpp: 50000,
    ...over,
  };
}

const customers: Customer[] = [
  { id: 'c1', name: 'Budi', phone: '081234567890', email: 'budi@mail.com', totalSpent: 0, visitCount: 0, createdAt: '2026-01-01' },
  { id: 'c2', name: 'Siti', phone: '081198765432', totalSpent: 0, visitCount: 0, createdAt: '2026-01-01' },
  { id: 'c3', name: 'Tanpa Kontak', totalSpent: 0, visitCount: 0, createdAt: '2026-01-01' },
];

describe('findCustomerContact (P0.4 — kontak dari CRM)', () => {
  it('pelanggan terdaftar → phone & email diambil', () => {
    expect(findCustomerContact(makeTx({ customerId: 'c1' }), customers)).toEqual({
      phone: '081234567890',
      email: 'budi@mail.com',
    });
  });

  it('pelanggan tanpa email → hanya phone', () => {
    expect(findCustomerContact(makeTx({ customerId: 'c2' }), customers)).toEqual({
      phone: '081198765432',
    });
  });

  it('tanpa customerId / pelanggan tidak ditemukan → kosong', () => {
    expect(findCustomerContact(makeTx({}), customers)).toEqual({});
    expect(findCustomerContact(makeTx({ customerId: 'zzz' }), customers)).toEqual({});
  });
});

// ============================================================
// autoSendReceiptTarget
// ============================================================

const baseSettings: AppSettings = {
  managerPin: '1234',
  storeName: 'Warung Berdikari',
  categories: [],
  printerEnabled: false,
  printerType: 'browser',
  printerWidth: '58mm',
  autoPrintOnCheckout: false,
  superAdminPin: '000000',
  demoMode: false,
};

describe('autoSendReceiptTarget (P0.4 — auto-kirim WA pasca-checkout)', () => {
  it('fitur aktif + pelanggan punya nomor valid → target terkirim', () => {
    const settings = { ...baseSettings, autoSendDigitalReceipt: true };
    expect(autoSendReceiptTarget(settings, customers[0])).toEqual({ phone: '081234567890' });
  });

  it('fitur nonaktif → null walau nomor ada', () => {
    expect(autoSendReceiptTarget(baseSettings, customers[0])).toBeNull();
  });

  it('fitur aktif tapi tanpa pelanggan / tanpa nomor → null', () => {
    const settings = { ...baseSettings, autoSendDigitalReceipt: true };
    expect(autoSendReceiptTarget(settings, null)).toBeNull();
    expect(autoSendReceiptTarget(settings, customers[2])).toBeNull(); // c3 tidak punya phone
  });

  it('fitur aktif + nomor tidak valid → null', () => {
    const settings = { ...baseSettings, autoSendDigitalReceipt: true };
    expect(autoSendReceiptTarget(settings, { ...customers[0], phone: '123' })).toBeNull();
  });
});
