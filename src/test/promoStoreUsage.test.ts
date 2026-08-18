import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock cloudSync — fetchPromosFromCloud untuk menguji merge ledger usageKeys lintas device.
vi.mock('../lib/cloudSync', () => ({
  syncPromo: vi.fn(),
  deletePromoCloud: vi.fn(),
  fetchPromosFromCloud: vi.fn().mockResolvedValue([]),
  syncLoyaltySettings: vi.fn(),
  fetchLoyaltySettingsFromCloud: vi.fn().mockResolvedValue(null),
}));

import { usePromoStore } from '../store/promoStore';
import { fetchPromosFromCloud } from '../lib/cloudSync';
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

// ============================================================
// v4.7 TO DO 18.8 (E7) — reservePromoUsage: guard race pemakaian promo
// ============================================================

describe('promoStore.reservePromoUsage (E7 — cek dari store + ledger id unik)', () => {
  beforeEach(() => {
    usePromoStore.setState({ promos: [makePromo('p1'), makePromo('p2')] });
  });

  it('tanpa batas → ok, usageCount & usageByCustomer naik', () => {
    const res = usePromoStore.getState().reservePromoUsage('p1', 'cust-1', 'tx-1');
    expect(res.ok).toBe(true);
    expect(res.idempotent).toBeUndefined();
    const p = usePromoStore.getState().promos[0];
    expect(p.usageCount).toBe(1);
    expect(p.usageByCustomer).toEqual({ 'cust-1': 1 });
    expect(p.usageKeys).toEqual({ 'tx-1': true });
  });

  it('REPLAY transaksi sama (usageKey sama) → idempoten, TIDAK increment dua kali', () => {
    usePromoStore.getState().reservePromoUsage('p1', undefined, 'tx-1');
    const replay = usePromoStore.getState().reservePromoUsage('p1', undefined, 'tx-1');
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(usePromoStore.getState().promos[0].usageCount).toBe(1);
  });

  it('batas GLOBAL tercapai → ditolak tanpa increment (cek dari store, bukan render)', () => {
    const p = usePromoStore.getState().promos[0];
    usePromoStore.setState({ promos: [{ ...p, usageLimit: 2, usageCount: 2 }] });
    const res = usePromoStore.getState().reservePromoUsage('p1', 'cust-1', 'tx-9');
    expect(res).toEqual({ ok: false, reason: 'limit-reached' });
    expect(usePromoStore.getState().promos[0].usageCount).toBe(2);
    expect(usePromoStore.getState().promos[0].usageKeys).toBeUndefined();
  });

  it('batas PER PELANGGAN tercapai → ditolak (pelanggan lain masih boleh)', () => {
    const p = usePromoStore.getState().promos[0];
    usePromoStore.setState({
      promos: [
        { ...p, usageLimitPerCustomer: 1, usageCount: 1, usageByCustomer: { 'cust-1': 1 } },
      ],
    });
    const denied = usePromoStore.getState().reservePromoUsage('p1', 'cust-1', 'tx-a');
    expect(denied).toEqual({ ok: false, reason: 'customer-limit-reached' });
    const allowed = usePromoStore.getState().reservePromoUsage('p1', 'cust-2', 'tx-b');
    expect(allowed.ok).toBe(true);
    expect(usePromoStore.getState().promos[0].usageByCustomer).toEqual({ 'cust-1': 1, 'cust-2': 1 });
  });

  it('dua panggilan berurutan yang melewati batas di device sama → hanya yang pertama lolos', () => {
    const p = usePromoStore.getState().promos[0];
    usePromoStore.setState({ promos: [{ ...p, usageLimit: 1, usageCount: 0 }] });
    const first = usePromoStore.getState().reservePromoUsage('p1', undefined, 'tx-1');
    const second = usePromoStore.getState().reservePromoUsage('p1', undefined, 'tx-2');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(usePromoStore.getState().promos[0].usageCount).toBe(1);
  });

  it('id tidak ditemukan → not-found tanpa perubahan', () => {
    const res = usePromoStore.getState().reservePromoUsage('nope', 'cust-1', 'tx-1');
    expect(res).toEqual({ ok: false, reason: 'not-found' });
    expect(usePromoStore.getState().promos[0].usageCount).toBe(0);
  });
});

describe('promoStore.loadFromCloud — merge ledger usageKeys UNION lintas device (E7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('usageKeys lokal + cloud digabung (bukan ditimpa last-write-wins)', async () => {
    // Lokal sudah mencatat tx-1 (device ini); cloud punya tx-2 (device lain)
    const local = { ...makePromo('p1'), usageCount: 1, usageKeys: { 'tx-1': true as const } };
    usePromoStore.setState({ promos: [local] });
    const cloud = [{ ...makePromo('p1'), usageCount: 1, usageKeys: { 'tx-2': true as const } }];
    (fetchPromosFromCloud as ReturnType<typeof vi.fn>).mockResolvedValue(cloud);

    await usePromoStore.getState().loadFromCloud(true);

    const p = usePromoStore.getState().promos[0];
    // Ledger gabungan: replay tx-1 ATAU tx-2 sama-sama terdeteksi idempoten
    expect(p.usageKeys).toEqual({ 'tx-1': true, 'tx-2': true });
    const replayLocal = usePromoStore.getState().reservePromoUsage('p1', undefined, 'tx-1');
    expect(replayLocal.idempotent).toBe(true);
    const replayOther = usePromoStore.getState().reservePromoUsage('p1', undefined, 'tx-2');
    expect(replayOther.idempotent).toBe(true);
    expect(usePromoStore.getState().promos[0].usageCount).toBe(1); // tidak ada increment tambahan
  });

  it('tanpa usageKeys di kedua sisi → promo tidak berubah (perilaku lama)', async () => {
    usePromoStore.setState({ promos: [makePromo('p1')] });
    const cloud = [{ ...makePromo('p1'), usageCount: 2 }];
    (fetchPromosFromCloud as ReturnType<typeof vi.fn>).mockResolvedValue(cloud);

    await usePromoStore.getState().loadFromCloud(true);

    const p = usePromoStore.getState().promos[0];
    expect(p.usageCount).toBe(2);
    expect(p.usageKeys).toBeUndefined();
  });
});
