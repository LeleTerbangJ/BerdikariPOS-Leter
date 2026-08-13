import { describe, it, expect } from 'vitest';
import { buildReceiptFromTransaction } from '../utils/printer';
import { buildReceiptText } from '../utils/digitalReceipt';
import type { AppSettings, Transaction } from '../types';
import type { ReceiptData } from '../utils/printer';

function makeSettings(): AppSettings {
  return {
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
}

function makeTx(over: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    queueNumber: 7,
    date: '2026-08-12T10:30:00.000Z',
    items: [],
    subtotal: 100000,
    discount: 10000,
    totalAmount: 90000,
    paymentMethod: 'Cash',
    kitchenStatus: 'Done',
    txStatus: 'Selesai',
    cashierId: 'u1',
    cashierName: 'Kasir 1',
    hpp: 50000,
    ...over,
  };
}

function makeReceiptData(over: Partial<ReceiptData> = {}): ReceiptData {
  return {
    storeName: 'Warung Berdikari',
    queueNumber: 7,
    date: '2026-08-12T10:30:00.000Z',
    cashierName: 'Kasir 1',
    items: [],
    subtotal: 100000,
    discount: 10000,
    tax: 9000,
    total: 99000,
    paymentMethod: 'Cash',
    ...over,
  };
}

// ============================================================
// buildReceiptFromTransaction — gating promo
// ============================================================

describe('buildReceiptFromTransaction (P-A7 — promo hanya bila memberi diskon)', () => {
  it('promoAmount > 0 → promoName & promoCode ikut di struk', () => {
    const data = buildReceiptFromTransaction(
      makeTx({ promoName: 'Diskon 10%', voucherCode: 'HEM10', promoAmount: 10000 }),
      makeSettings()
    );
    expect(data.promoName).toBe('Diskon 10%');
    expect(data.promoCode).toBe('HEM10');
    expect(data.promoAmount).toBe(10000);
  });

  it('promoAmount 0 (promo eksklusif kalah best-deal) → promo TIDAK tampil di struk', () => {
    const data = buildReceiptFromTransaction(
      makeTx({ promoName: 'Diskon 10%', voucherCode: 'HEM10', promoAmount: 0 }),
      makeSettings()
    );
    expect(data.promoName).toBeUndefined();
    expect(data.promoCode).toBeUndefined();
  });

  it('promoAmount undefined (data legacy) → promo TIDAK tampil', () => {
    const data = buildReceiptFromTransaction(makeTx({ promoName: 'X', voucherCode: 'Y' }), makeSettings());
    expect(data.promoName).toBeUndefined();
    expect(data.promoCode).toBeUndefined();
  });

  it('tanpa promo sama sekali → field tidak ada', () => {
    const data = buildReceiptFromTransaction(makeTx({}), makeSettings());
    expect(data.promoName).toBeUndefined();
    expect(data.promoCode).toBeUndefined();
  });
});

// ============================================================
// buildReceiptText — baris Promo di struk digital
// ============================================================

describe('buildReceiptText — baris promo (P-A7)', () => {
  it('dengan promo + kode → baris "Promo: Nama (KODE)" di antara Diskon & Pajak', () => {
    const text = buildReceiptText(
      makeReceiptData({ promoName: 'Diskon 10%', promoCode: 'HEM10' })
    );
    expect(text).toContain('Promo: Diskon 10% (HEM10)');
    expect(text.indexOf('Diskon')).toBeLessThan(text.indexOf('Promo: Diskon 10%'));
    expect(text.indexOf('Promo: Diskon 10%')).toBeLessThan(text.indexOf('Pajak'));
  });

  it('dengan promo tanpa kode → hanya nama', () => {
    const text = buildReceiptText(makeReceiptData({ promoName: 'BOGO Lele' }));
    expect(text).toContain('Promo: BOGO Lele');
  });

  it('tanpa promo → tidak ada baris Promo', () => {
    const text = buildReceiptText(makeReceiptData());
    expect(text).not.toContain('Promo:');
  });

  it('bukan HTML — baris promo tetap teks polos', () => {
    const text = buildReceiptText(makeReceiptData({ promoName: 'Diskon 10%', promoCode: 'HEM10' }));
    expect(text).not.toContain('<div');
    expect(text).not.toContain('</');
  });
});
