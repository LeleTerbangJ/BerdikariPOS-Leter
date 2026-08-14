import { describe, it, expect, beforeEach } from 'vitest';
import { useTransactionStore } from '../store/transactionStore';
import type { Transaction } from '../types';

function makeTx(id: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    queueNumber: 1,
    date: new Date().toISOString(),
    items: [],
    subtotal: 10000,
    discount: 0,
    totalAmount: 10000,
    paymentMethod: 'Cash',
    cashReceived: 10000,
    change: 0,
    kitchenStatus: 'Done',
    txStatus: 'Selesai',
    cashierId: 'u1',
    cashierName: 'Kasir',
    hpp: 5000,
    ...overrides,
  };
}

describe('transactionStore — confirmedSyncIds & badge "Belum Sync" (v4.7 O-5)', () => {
  beforeEach(() => {
    useTransactionStore.setState({ transactions: [], confirmedSyncIds: [], deletedLocalIds: [] });
  });

  it('loadFromCloud mengonfirmasi id yang ada di cloud (badge "Belum Sync" hilang)', () => {
    const t = makeTx('t1');
    useTransactionStore.getState().loadFromCloud([t], true);
    const confirmed = useTransactionStore.getState().confirmedSyncIds;
    expect(confirmed).toContain('t1');
  });

  it('transaksi lokal yang belum ada di cloud TIDAK terkonfirmasi (badge "Belum Sync" tampil)', () => {
    const local = makeTx('local-only', { queueNumber: 2 });
    const cloud = makeTx('cloud-1');
    // Simulasi: transaksi lokal belum sync + fetch cloud hanya mengembalikan cloud-1
    useTransactionStore.setState((s) => ({ transactions: [local, cloud] }));
    useTransactionStore.getState().loadFromCloud([cloud], true);
    const confirmed = useTransactionStore.getState().confirmedSyncIds;
    expect(confirmed).toContain('cloud-1');
    expect(confirmed).not.toContain('local-only');
    // Predicate badge: transaksi lokal tetap tampil sebagai "Belum Sync"
    expect(confirmed.includes(local.id)).toBe(false);
  });

  it('markTransactionConfirmed idempoten — id tidak terduplikasi', () => {
    useTransactionStore.getState().markTransactionConfirmed('x');
    useTransactionStore.getState().markTransactionConfirmed('x');
    const confirmed = useTransactionStore.getState().confirmedSyncIds;
    expect(confirmed.filter((i) => i === 'x')).toHaveLength(1);
  });

  it('deleteTransaction menghapus id dari confirmedSyncIds', () => {
    useTransactionStore.getState().loadFromCloud([makeTx('t1')], true);
    expect(useTransactionStore.getState().confirmedSyncIds).toContain('t1');
    useTransactionStore.getState().deleteTransaction('t1');
    expect(useTransactionStore.getState().confirmedSyncIds).not.toContain('t1');
  });

  it('loadFromCloud kedua menambahkan id baru tanpa menghapus konfirmasi lama (union)', () => {
    useTransactionStore.getState().loadFromCloud([makeTx('t1')], true);
    useTransactionStore.getState().markTransactionConfirmed('t-pending');
    useTransactionStore.getState().loadFromCloud([makeTx('t2')], true);
    const confirmed = useTransactionStore.getState().confirmedSyncIds;
    expect(confirmed).toContain('t1');
    expect(confirmed).toContain('t2');
    expect(confirmed).toContain('t-pending');
  });
});
