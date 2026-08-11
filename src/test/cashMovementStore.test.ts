import { describe, it, expect, beforeEach } from 'vitest';
import { useCashMovementStore } from '../store/cashMovementStore';

describe('cashMovementStore — konfirmasi sync & badge "Belum Sync" (v4.6 fix #3)', () => {
  beforeEach(() => {
    useCashMovementStore.setState({ movements: [], confirmedSyncIds: [] });
  });

  it('addMovement menambah movement lokal dan BELUM terkonfirmasi (badge "Belum Sync" tampil saat belum sync)', () => {
    const m = useCashMovementStore.getState().addMovement(
      'in', 50000, 'Modal Tambahan', undefined, 'user-1', 'Kasir 1', 'shift-1'
    );
    const s = useCashMovementStore.getState();
    expect(s.movements.some((x) => x.id === m.id)).toBe(true);
    expect(s.confirmedSyncIds).not.toContain(m.id);
  });

  it('konfirmasi sync idempoten — id terkonfirmasi tidak terduplikasi', () => {
    const m = useCashMovementStore.getState().addMovement(
      'in', 50000, 'Modal Tambahan', undefined, 'user-1', 'Kasir 1', 'shift-1'
    );
    // Simulasi konfirmasi dari jalur sync (markConfirmed internal): dua kali
    useCashMovementStore.setState((s) => (
      s.confirmedSyncIds.includes(m.id) ? s : { confirmedSyncIds: [...s.confirmedSyncIds, m.id] }
    ));
    useCashMovementStore.setState((s) => (
      s.confirmedSyncIds.includes(m.id) ? s : { confirmedSyncIds: [...s.confirmedSyncIds, m.id] }
    ));
    const s = useCashMovementStore.getState();
    expect(s.confirmedSyncIds.filter((x) => x === m.id)).toHaveLength(1);
  });

  it('deleteMovementLocal menghapus movement DAN id konfirmasinya', () => {
    const m = useCashMovementStore.getState().addMovement(
      'out', 10000, 'Biaya Operasional', undefined, 'user-1', 'Kasir 1', 'shift-1'
    );
    useCashMovementStore.setState((s) => ({ confirmedSyncIds: [...s.confirmedSyncIds, m.id] }));
    useCashMovementStore.getState().deleteMovementLocal(m.id);
    const s = useCashMovementStore.getState();
    expect(s.movements.some((x) => x.id === m.id)).toBe(false);
    expect(s.confirmedSyncIds).not.toContain(m.id);
  });

  it('updateMovement meng-invalidasi konfirmasi — badge tampil lagi setelah edit', async () => {
    const m = useCashMovementStore.getState().addMovement(
      'in', 50000, 'Modal Tambahan', undefined, 'user-1', 'Kasir 1', 'shift-1'
    );
    useCashMovementStore.setState((s) => ({ confirmedSyncIds: [...s.confirmedSyncIds, m.id] }));

    await useCashMovementStore.getState().updateMovement(m.id, {
      amount: 60000,
      category: 'Pemasukan Operasional',
    });

    const s = useCashMovementStore.getState();
    expect(s.movements.find((x) => x.id === m.id)?.amount).toBe(60000);
    expect(s.confirmedSyncIds).not.toContain(m.id);
  });
});
