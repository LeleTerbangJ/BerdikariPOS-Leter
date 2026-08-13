import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyStatusStockEffects,
  type TransactionStockActions,
  type StockEffectTarget,
} from '../utils/transactionStockActions';

// ============================================================
// TO DO 8.1 & 8.2 — efek stok/kunjungan pada transisi status & delete
// ============================================================

function makeActions() {
  return {
    revertStock: vi.fn(),
    deductStock: vi.fn(),
    revertVisit: vi.fn(),
    recordVisit: vi.fn(),
  } as TransactionStockActions;
}

function makeTarget(overrides: Partial<StockEffectTarget> = {}): StockEffectTarget {
  return {
    txStatus: 'Selesai',
    customerId: 'cust-1',
    totalAmount: 10000,
    queueNumber: 7,
    ...overrides,
  };
}

const DEDUCTIONS = { invA: 6 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TO DO 8.1 — Demo → Selesai (re-enable) memotong stok', () => {
  it('Demo → Selesai: deductStock + recordVisit dipanggil (sebelumnya bocor — penjualan tanpa potong bahan baku)', () => {
    const actions = makeActions();
    applyStatusStockEffects(
      makeTarget({ txStatus: 'Demo' }),
      'Selesai',
      false,
      () => DEDUCTIONS,
      actions
    );

    expect(actions.deductStock).toHaveBeenCalledTimes(1);
    expect(actions.deductStock).toHaveBeenCalledWith(
      DEDUCTIONS,
      expect.stringContaining('Re-enable transaksi #7')
    );
    expect(actions.recordVisit).toHaveBeenCalledWith('cust-1', 10000);
    expect(actions.revertStock).not.toHaveBeenCalled();
  });

  it('Cancel → Selesai tetap deduct + recordVisit (perilaku lama dipertahankan)', () => {
    const actions = makeActions();
    applyStatusStockEffects(
      makeTarget({ txStatus: 'Cancel' }),
      'Selesai',
      false,
      () => DEDUCTIONS,
      actions
    );

    expect(actions.deductStock).toHaveBeenCalledTimes(1);
    expect(actions.recordVisit).toHaveBeenCalledTimes(1);
  });
});

describe('TO DO 8.2 — hapus transaksi Pending me-revert stok reserve', () => {
  it('DELETE Pending: revertStock dipanggil tanpa revertVisit (reserve kembali)', () => {
    const actions = makeActions();
    applyStatusStockEffects(
      makeTarget({ txStatus: 'Pending' }),
      'DELETE',
      false,
      () => DEDUCTIONS,
      actions
    );

    expect(actions.revertStock).toHaveBeenCalledTimes(1);
    expect(actions.revertStock).toHaveBeenCalledWith(
      DEDUCTIONS,
      expect.stringContaining('Hapus pesanan gantung #7')
    );
    expect(actions.revertVisit).not.toHaveBeenCalled();
    expect(actions.deductStock).not.toHaveBeenCalled();
  });

  it('DELETE Selesai: revertStock + revertVisit (perilaku lama dipertahankan)', () => {
    const actions = makeActions();
    applyStatusStockEffects(makeTarget(), 'DELETE', false, () => DEDUCTIONS, actions);

    expect(actions.revertStock).toHaveBeenCalledTimes(1);
    expect(actions.revertVisit).toHaveBeenCalledWith('cust-1', 10000);
  });

  it('DELETE Cancel/Demo: TIDAK ada efek (stok sudah dikembalikan saat transisi sebelumnya)', () => {
    for (const st of ['Cancel', 'Demo'] as const) {
      const actions = makeActions();
      applyStatusStockEffects(makeTarget({ txStatus: st }), 'DELETE', false, () => DEDUCTIONS, actions);
      expect(actions.revertStock).not.toHaveBeenCalled();
      expect(actions.deductStock).not.toHaveBeenCalled();
      expect(actions.revertVisit).not.toHaveBeenCalled();
    }
  });
});

describe('Transisi yang dipertahankan (regresi)', () => {
  it('Selesai → Cancel: revertStock + revertVisit', () => {
    const actions = makeActions();
    applyStatusStockEffects(makeTarget(), 'Cancel', false, () => DEDUCTIONS, actions);
    expect(actions.revertStock).toHaveBeenCalledWith(DEDUCTIONS, expect.stringContaining('Cancel transaksi #7'));
    expect(actions.revertVisit).toHaveBeenCalledTimes(1);
  });

  it('Selesai → Demo: revertStock + revertVisit', () => {
    const actions = makeActions();
    applyStatusStockEffects(makeTarget(), 'Demo', false, () => DEDUCTIONS, actions);
    expect(actions.revertStock).toHaveBeenCalledWith(DEDUCTIONS, expect.stringContaining('Ubah transaksi #7 menjadi Demo'));
    expect(actions.revertVisit).toHaveBeenCalledTimes(1);
  });

  it('Pending → Cancel: revertStock reserve saja', () => {
    const actions = makeActions();
    applyStatusStockEffects(makeTarget({ txStatus: 'Pending' }), 'Cancel', false, () => DEDUCTIONS, actions);
    expect(actions.revertStock).toHaveBeenCalledWith(DEDUCTIONS, expect.stringContaining('Cancel pesanan gantung #7'));
    expect(actions.revertVisit).not.toHaveBeenCalled();
  });

  it('Pending → Demo: revertStock reserve saja', () => {
    const actions = makeActions();
    applyStatusStockEffects(makeTarget({ txStatus: 'Pending' }), 'Demo', false, () => DEDUCTIONS, actions);
    expect(actions.revertStock).toHaveBeenCalledWith(DEDUCTIONS, expect.stringContaining('Ubah pesanan gantung #7 menjadi Demo'));
    expect(actions.revertVisit).not.toHaveBeenCalled();
  });

  it('Pending → Selesai: TIDAK ada efek (reserve sudah terpotong saat pending dibuat)', () => {
    const actions = makeActions();
    applyStatusStockEffects(makeTarget({ txStatus: 'Pending' }), 'Selesai', false, () => DEDUCTIONS, actions);
    expect(actions.revertStock).not.toHaveBeenCalled();
    expect(actions.deductStock).not.toHaveBeenCalled();
    expect(actions.recordVisit).not.toHaveBeenCalled();
  });

  it('Selesai → Selesai: tidak ada efek (no-op)', () => {
    const actions = makeActions();
    applyStatusStockEffects(makeTarget(), 'Selesai', false, () => DEDUCTIONS, actions);
    expect(actions.revertStock).not.toHaveBeenCalled();
    expect(actions.deductStock).not.toHaveBeenCalled();
  });
});

describe('Guard split (isSplit)', () => {
  it('isSplit=true → TIDAK ADA efek apa pun (stok dikelola sesi split)', () => {
    for (const to of ['Selesai', 'Cancel', 'Demo', 'DELETE'] as const) {
      const actions = makeActions();
      applyStatusStockEffects(makeTarget(), to, true, () => DEDUCTIONS, actions);
      expect(actions.revertStock).not.toHaveBeenCalled();
      expect(actions.deductStock).not.toHaveBeenCalled();
      expect(actions.revertVisit).not.toHaveBeenCalled();
      expect(actions.recordVisit).not.toHaveBeenCalled();
    }
  });
});

// ============================================================
// P0.2 — guard transaksi refunded (stok & kunjungan sudah di-revert saat refund)
// ============================================================

describe('Guard refunded (P0.2 — anti double-revert)', () => {
  it('refunded=true → TIDAK ADA efek untuk Cancel/Demo/Delete (stok sudah dikembalikan saat refund)', () => {
    for (const to of ['Cancel', 'Demo', 'DELETE'] as const) {
      const actions = makeActions();
      applyStatusStockEffects(
        makeTarget({ refunded: true }),
        to,
        false,
        () => DEDUCTIONS,
        actions
      );
      expect(actions.revertStock).not.toHaveBeenCalled();
      expect(actions.deductStock).not.toHaveBeenCalled();
      expect(actions.revertVisit).not.toHaveBeenCalled();
      expect(actions.recordVisit).not.toHaveBeenCalled();
    }
  });

  it('refunded=true + DELETE → revertStock TIDAK dipanggil (sebelumnya Selesai → DELETE revert 2×)', () => {
    const actions = makeActions();
    applyStatusStockEffects(makeTarget({ refunded: true }), 'DELETE', false, () => DEDUCTIONS, actions);
    expect(actions.revertStock).not.toHaveBeenCalled();
    expect(actions.revertVisit).not.toHaveBeenCalled();
  });

  it('refunded=false → perilaku normal tetap berjalan (regresi)', () => {
    const actions = makeActions();
    applyStatusStockEffects(makeTarget({ refunded: false }), 'DELETE', false, () => DEDUCTIONS, actions);
    expect(actions.revertStock).toHaveBeenCalledTimes(1);
    expect(actions.revertVisit).toHaveBeenCalledTimes(1);
  });
});

describe('Edge cases', () => {
  it('tanpa customerId → tidak memanggil recordVisit/revertVisit', () => {
    const actions = makeActions();
    applyStatusStockEffects(
      makeTarget({ customerId: undefined, txStatus: 'Demo' }),
      'Selesai',
      false,
      () => DEDUCTIONS,
      actions
    );
    expect(actions.deductStock).toHaveBeenCalledTimes(1);
    expect(actions.recordVisit).not.toHaveBeenCalled();
  });

  it('tanpa queueNumber → reason memakai placeholder "?" (tidak crash)', () => {
    const actions = makeActions();
    applyStatusStockEffects(
      makeTarget({ queueNumber: undefined, txStatus: 'Pending' }),
      'DELETE',
      false,
      () => DEDUCTIONS,
      actions
    );
    expect(actions.revertStock).toHaveBeenCalledWith(DEDUCTIONS, expect.stringContaining('#?'));
  });
});
