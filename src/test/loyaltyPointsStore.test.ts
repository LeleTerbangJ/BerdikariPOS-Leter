import { describe, it, expect, beforeEach } from 'vitest';
import { useCustomerStore } from '../store/customerStore';
import { usePromoStore } from '../store/promoStore';
import type { Customer, LoyaltySettings } from '../types';

const pointsSettings: LoyaltySettings = {
  enabled: true,
  pointsPerTransaction: 1,
  pointsPerRupiah: 10000,
  redeemPointsValue: 1000,
  tierBronzeMinVisits: 5,
  tierSilverMinVisits: 15,
  tierGoldMinVisits: 30,
  tierBronzeDiscount: 5,
  tierSilverDiscount: 10,
  tierGoldDiscount: 15,
};

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 'cust-1',
    name: 'Budi',
    totalSpent: 0,
    visitCount: 0,
    loyaltyPoints: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('customerStore poin loyalty (P-A8 — earn, clawback, redeem)', () => {
  beforeEach(() => {
    useCustomerStore.setState({ customers: [makeCustomer()] });
    usePromoStore.setState((s) => ({ loyaltySettings: { ...s.loyaltySettings, ...pointsSettings } }));
  });

  it('recordVisit memberi poin (1 + total ÷ 10.000) saat loyalty aktif', () => {
    useCustomerStore.getState().recordVisit('cust-1', 25000);
    const c = useCustomerStore.getState().customers[0];
    expect(c.loyaltyPoints).toBe(3); // 1 + 2
    expect(c.visitCount).toBe(1);
    expect(c.totalSpent).toBe(25000);
  });

  it('recordVisit TIDAK memberi poin saat loyalty nonaktif', () => {
    usePromoStore.setState((s) => ({ loyaltySettings: { ...s.loyaltySettings, enabled: false } }));
    useCustomerStore.getState().recordVisit('cust-1', 25000);
    expect(useCustomerStore.getState().customers[0].loyaltyPoints).toBe(0);
  });

  it('revertVisit mengembalikan (clawback) poin yang didapat — simetris dengan earn', () => {
    useCustomerStore.getState().recordVisit('cust-1', 25000); // +3
    useCustomerStore.getState().revertVisit('cust-1', 25000); // -3
    const c = useCustomerStore.getState().customers[0];
    expect(c.loyaltyPoints).toBe(0);
    expect(c.visitCount).toBe(0);
  });

  it('clawback tidak membuat poin negatif (void transaksi berpoin yang sudah ditukar)', () => {
    useCustomerStore.getState().recordVisit('cust-1', 100000); // +11
    useCustomerStore.getState().deductLoyaltyPoints('cust-1', 10); // -10 → 1
    useCustomerStore.getState().revertVisit('cust-1', 100000); // -11 → clamp 0
    expect(useCustomerStore.getState().customers[0].loyaltyPoints).toBe(0);
  });

  it('deductLoyaltyPoints memotong saldo; addLoyaltyPoints menambah', () => {
    useCustomerStore.getState().addLoyaltyPoints('cust-1', 7);
    expect(useCustomerStore.getState().customers[0].loyaltyPoints).toBe(7);
    useCustomerStore.getState().deductLoyaltyPoints('cust-1', 3);
    expect(useCustomerStore.getState().customers[0].loyaltyPoints).toBe(4);
    // tidak bisa negatif
    useCustomerStore.getState().deductLoyaltyPoints('cust-1', 999);
    expect(useCustomerStore.getState().customers[0].loyaltyPoints).toBe(0);
  });

  it('poin 0/negatif tidak mengubah apa pun', () => {
    useCustomerStore.getState().addLoyaltyPoints('cust-1', 0);
    useCustomerStore.getState().deductLoyaltyPoints('cust-1', -5);
    expect(useCustomerStore.getState().customers[0].loyaltyPoints).toBe(0);
  });
});
