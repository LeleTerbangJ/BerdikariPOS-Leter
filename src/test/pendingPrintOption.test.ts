import { describe, it, expect, vi, beforeEach } from 'vitest';

const printReceiptMock = vi.fn();
vi.mock('../utils/printer', () => ({
  printReceipt: (...args: unknown[]) => printReceiptMock(...args),
  buildReceiptFromTransaction: vi.fn(() => ({ items: [] })),
}));

import { seedSettings } from '../utils/seed';
import { useSettingsStore } from '../store/settingsStore';
import { AtomicTransactionEngine } from '../lib/atomicTransactionEngine';
import type { CartItem } from '../types';

describe('Pending Payment Print Options', () => {
  beforeEach(() => {
    printReceiptMock.mockReset();
    printReceiptMock.mockResolvedValue([{ printer: 'Cashier', status: 'success' }]);
  });

  it('default seedSettings has pendingPrintOption set to dapur_only', () => {
    expect(seedSettings.pendingPrintOption).toBe('dapur_only');
  });

  it('updates pendingPrintOption setting correctly', () => {
    useSettingsStore.getState().updateSettings({ pendingPrintOption: 'ask' });
    expect(useSettingsStore.getState().settings.pendingPrintOption).toBe('ask');
  });

  it('AtomicTransactionEngine respects skipReceiptPrint when saving pending', async () => {
    const testItem: CartItem = {
      lineId: 'line-1',
      menuId: 'm1',
      name: 'Jamu Kunyit',
      basePrice: 15000,
      quantity: 1,
      temperature: 'Dingin',
      sugar: 'Normal',
      addons: [],
      subtotal: 15000,
    };

    const settings = {
      ...seedSettings,
      printerEnabled: true,
      pendingPrintOption: 'dapur_only' as const,
    };

    await AtomicTransactionEngine.executeCheckout({
      transactionId: 'test-pending-1',
      cartItems: [testItem],
      subtotal: 15000,
      discount: 0,
      taxAmount: 0,
      totalAmount: 15000,
      payMethod: 'Cash',
      orderType: 'Dine In',
      settings,
      overrideTxStatus: 'Pending',
      skipReceiptPrint: true,
      skipKitchenPrint: false,
    });

    // printReceipt should be called for kitchen target, but NOT for cashier target
    const cashierCalls = printReceiptMock.mock.calls.filter((call) => call[2] === 'cashier');
    const kitchenCalls = printReceiptMock.mock.calls.filter((call) => call[2] === 'kitchen');

    expect(cashierCalls.length).toBe(0);
    expect(kitchenCalls.length).toBe(1);
  });

  it('AtomicTransactionEngine prints both cashier and kitchen when skipReceiptPrint is false', async () => {
    const testItem: CartItem = {
      lineId: 'line-2',
      menuId: 'm1',
      name: 'Jamu Kunyit',
      basePrice: 15000,
      quantity: 1,
      temperature: 'Dingin',
      sugar: 'Normal',
      addons: [],
      subtotal: 15000,
    };

    const settings = {
      ...seedSettings,
      printerEnabled: true,
      pendingPrintOption: 'dapur_and_cashier' as const,
    };

    await AtomicTransactionEngine.executeCheckout({
      transactionId: 'test-pending-2',
      cartItems: [testItem],
      subtotal: 15000,
      discount: 0,
      taxAmount: 0,
      totalAmount: 15000,
      payMethod: 'Cash',
      orderType: 'Dine In',
      settings,
      overrideTxStatus: 'Pending',
      skipReceiptPrint: false,
      skipKitchenPrint: false,
    });

    const cashierCalls = printReceiptMock.mock.calls.filter((call) => call[2] === 'cashier');
    const kitchenCalls = printReceiptMock.mock.calls.filter((call) => call[2] === 'kitchen');

    expect(cashierCalls.length).toBe(1);
    expect(kitchenCalls.length).toBe(1);
  });
});
