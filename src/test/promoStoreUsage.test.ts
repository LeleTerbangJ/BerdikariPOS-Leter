import { describe, it, expect, beforeEach } from 'vitest';
import { usePromoStore } from '../store/promoStore';
import type { Promo } from '../types';

function makePromo(id: string): Promo {
  return {
    id,
    name: 'Promo Test',
    type: 'percentage',
    value: 10,
    scope: 'all',
    isActive: true,
    usageCount: 0,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-12-31T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('promoStore.incrementUsage (P-A6 — pencatatan pemakaian per pelanggan)', () => {
  beforeEach(() => {
    usePromoStore.setState({ promos: [makePromo('p1'), makePromo('p2')] });
  });

  it('tanpa customerId → hanya usageCount global naik (perilaku lama)', () => {
    usePromoStore.getState().incrementUsage('p1');
    const p = usePromoStore.getState().promos[0];
    expect(p.usageCount).toBe(1);
    expect(p.usageByCustomer).toBeUndefined();
  });

  it('dengan customerId → usageCount global DAN per pelanggan naik', () => {
    usePromoStore.getState().incrementUsage('p1', 'cust-1');
    usePromoStore.getState().incrementUsage('p1', 'cust-1');
    usePromoStore.getState().incrementUsage('p1', 'cust-2');

    const p = usePromoStore.getState().promos[0];
    expect(p.usageCount).toBe(3);
    expect(p.usageByCustomer).toEqual({ 'cust-1': 2, 'cust-2': 1 });
  });

  it('tidak mengubah promo lain', () => {
    usePromoStore.getState().incrementUsage('p1', 'cust-1');
    const p2 = usePromoStore.getState().promos[1];
    expect(p2.usageCount).toBe(0);
    expect(p2.usageByCustomer).toBeUndefined();
  });

  it('id tidak ditemukan → tidak ada perubahan', () => {
    usePromoStore.getState().incrementUsage('nope', 'cust-1');
    expect(usePromoStore.getState().promos[0].usageCount).toBe(0);
  });
});
