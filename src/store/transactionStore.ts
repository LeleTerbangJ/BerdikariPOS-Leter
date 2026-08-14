import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../utils/idbStorage';
import { pruneTransactionsForStorage, filterTombstoned, pruneConfirmedTombstones, DEFAULT_TOMBSTONE_CAP } from '../utils/storagePrune';
import type { Transaction, KitchenStatus, TxStatus } from '../types';

// v4.1 TO DO 3.1/3.2: predicate tunggal pesanan pending — satu sumber kebenaran agar
// angka konsisten di POS, Layout, PendingPaymentsModal & Transactions (paritas angka).
export const isPendingTransaction = (t: Transaction): boolean =>
  t.txStatus === 'Pending' || t.isPending === true;

// v4.5 TO DO 5.3: predicate transaksi induk yang memiliki anak split (transaksi lain dengan
// splitParentId === id). Dipakai guard stok di cancelPendingTransaction — stok pending yang
// sudah displit dikelola sesi split (anak-anak 'Selesai' & stoknya terpakai sah) → jangan revert.
export const hasPendingSplitChildren = (allTxs: Transaction[], parentId: string): boolean =>
  allTxs.some((t) => t.splitParentId === parentId);
import { syncTransaction, syncTransactionStatus, syncTransactionTxStatus, syncTransactionMeta, deleteTransactionCloud } from '../lib/cloudSync';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { calculateItemDeductions } from '../utils/hpp';
import { useMenuStore } from './menuStore';
import { useInventoryStore } from './inventoryStore';

interface TransactionState {
  transactions: Transaction[];
  nextQueueNumber: number;
  lastQueueDate: string | null;
  lastKdsClearTime: string | null;
  // v4.5 TO DO 6.5: tombstone ID transaksi yang dihapus/rollback lokal — cegah re-hidrasi dari cloud (ghost)
  deletedLocalIds: string[];
  // v4.7 TO DO 13.7 (O-5): id transaksi yang terkonfirmasi ada di cloud (badge "Belum Sync")
  // TIDAK dipersist — dibangun ulang dari cloud tiap boot (pola cashMovementStore).
  confirmedSyncIds: string[];
  markTransactionConfirmed: (id: string) => void;
  addTransaction: (tx: Transaction) => void;
  updateKitchenStatus: (id: string, status: KitchenStatus) => void;
  updateTxStatus: (id: string, status: TxStatus) => void;
  // v4.1 TO DO 2.8: perbarui metadata transaksi (mis. paymentMethod parent split) tanpa menyentuh status/cloud
  updateTxMeta: (id: string, partial: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;
  deleteTransactionLocal: (id: string) => void;
  getTodayTransactions: () => Transaction[];
  getActiveKitchenOrders: () => Transaction[];
  clearKdsDoneOrders: () => void;
  getNextQueueNumber: () => Promise<number>;
  cancelPendingTransaction: (id: string) => void;
  loadFromCloud: (transactions: Transaction[], fullSync?: boolean) => void;
}

function getTodayDateStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const useTransactionStore = create<TransactionState>()(
  persist(
    (set, get) => ({
      transactions: [],
      nextQueueNumber: 1,
      lastQueueDate: null,
      lastKdsClearTime: null,
      deletedLocalIds: [],
      confirmedSyncIds: [],

      markTransactionConfirmed: (id) => {
        set((s) => {
          if (s.confirmedSyncIds.includes(id)) return s;
          return { confirmedSyncIds: [...s.confirmedSyncIds, id] };
        });
      },

      getNextQueueNumber: async () => {
        const today = getTodayDateStr();
        
        // Try to fetch max queue number from Supabase to prevent multi-device race conditions
        if (isSupabaseConfigured && navigator.onLine) {
          try {
            const todayStart = `${today}T00:00:00.000Z`;
            const todayEnd = `${today}T23:59:59.999Z`;
            const { data, error } = await supabase
              .from('transactions')
              .select('queue_number')
              .gte('date', todayStart)
              .lte('date', todayEnd)
              .neq('tx_status', 'Demo')
              .neq('tx_status', 'Cancel')
              .order('queue_number', { ascending: false })
              .limit(1);

            if (!error && data && data.length > 0) {
              const cloudMax = data[0].queue_number || 0;
              const localTxs = get().transactions.filter(
                (t) => t.date.startsWith(today) && t.txStatus !== 'Demo' && t.txStatus !== 'Cancel'
              );
              const localMax = localTxs.reduce((max, t) => Math.max(max, t.queueNumber || 0), 0);
              const absoluteMax = Math.max(cloudMax, localMax);
              return absoluteMax + 1;
            }
          } catch (e) {
            console.warn('Failed to fetch max queue number from cloud, falling back to local:', e);
          }
        }

        // Fallback to local calculation (offline-first)
        // v4.7 TO DO 13.6 (O-6, batasan terdokumentasi): dua device OFFLINE bisa memberi
        // nomor antrean yang sama (tanpa otoritas pusat). Setelah sync, `loadFromCloud`
        // mendeteksi & menormalkan nextQueueNumber dari max gabungan; duplikat pada
        // transaksi yang sudah terlanjur dibuat tetap mungkin (label #N kembar) —
        // mitigasi penuh (alokasi range per device / renumber) di TO DO 13.6.
        const todayTxs = get().transactions.filter(
          (t) => t.date.startsWith(today) && t.txStatus !== 'Demo' && t.txStatus !== 'Cancel'
        );
        const maxQueue = todayTxs.reduce((max, t) => Math.max(max, t.queueNumber || 0), 0);
        return maxQueue + 1;
      },

      addTransaction: (tx) => {
        // v4.7 TO DO 13.7 (O-5): konfirmasi saat benar-benar sampai cloud (badge "Belum Sync" hilang)
        void syncTransaction(tx).then((ok) => {
          if (ok) get().markTransactionConfirmed(tx.id);
        });
        set((s) => {
          const today = getTodayDateStr();
          const filteredExisting = s.transactions.filter((t) => t.id !== tx.id);
          const nextList = [tx, ...filteredExisting];
          const todayTxs = nextList.filter(
            (t) => t.date.startsWith(today) && t.txStatus !== 'Demo' && t.txStatus !== 'Cancel'
          );
          const maxQueue = todayTxs.reduce((max, t) => Math.max(max, t.queueNumber || 0), 0);
          return {
            transactions: nextList,
            nextQueueNumber: maxQueue + 1,
            lastQueueDate: today,
            // v4.5 TO DO 6.5: re-commit ID yang sama (resume pending) membatalkan tombstone
            deletedLocalIds: s.deletedLocalIds.filter((d) => d !== tx.id),
          };
        });
      },

      updateKitchenStatus: (id, status) => {
        syncTransactionStatus(id, status); // Cloud sync
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, kitchenStatus: status } : t
          ),
        }));
      },

      updateTxStatus: (id, status) => {
        syncTransactionTxStatus(id, status); // Cloud sync
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, txStatus: status, isPending: status === 'Pending' } : t
          ),
        }));
      },

      // v4.1 TO DO 2.8 + v4.5 TO DO 5.8: update metadata (paymentMethod parent split, dst.) — status
      // tetap via updateTxStatus. Kini ikut sync cloud (payment_method) agar device lain melihat
      // distribusi pembayaran yang benar lintas device.
      updateTxMeta: (id, partial) => {
        syncTransactionMeta(id, partial); // Cloud sync (field terpilih saja)
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, ...partial } : t
          ),
        }));
      },

      deleteTransaction: (id) => {
        deleteTransactionCloud(id); // Cloud sync
        set((s) => ({
          transactions: s.transactions.filter((t) => t.id !== id),
          // v4.5 TO DO 6.5: tombstone anti-ghost — cegah re-hidrasi dari cloud selama
          // penghapusan cloud belum dikonfirmasi (offline/queue). v4.7 TO DO 13.12 (O-8):
          // cap dinaikkan (store transaksi IndexedDB → kuota besar); tombstones dibersihkan
          // otomatis di loadFromCloud saat id sudah hilang dari cloud (pruneConfirmedTombstones).
          deletedLocalIds: [...s.deletedLocalIds, id].slice(-DEFAULT_TOMBSTONE_CAP),
          confirmedSyncIds: s.confirmedSyncIds.filter((x) => x !== id),
        }));
      },

      deleteTransactionLocal: (id) => {
        set((s) => ({
          transactions: s.transactions.filter((t) => t.id !== id),
        }));
      },

      getTodayTransactions: () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return get().transactions.filter(
          (t) => new Date(t.date) >= today && t.txStatus !== 'Demo' && t.txStatus !== 'Cancel'
        );
      },

      cancelPendingTransaction: (id) => {
        const tx = get().transactions.find((t) => t.id === id);
        if (!tx) return;
        get().updateTxStatus(id, 'Cancel');

        // v4.5 TO DO 5.3: pending yang sudah di-resume lalu displit → anak-anak (splitParentId === id)
        // sudah 'Selesai' & stoknya terpakai sah (dikelola sesi split) — JANGAN revert stok di sini
        // (guard paritas dengan Transactions.tsx onConfirmAction/onPinSuccess).
        if (hasPendingSplitChildren(get().transactions, id)) return;
        if (!tx.items || tx.items.length === 0) return;

        // v4.5 TO DO 5.4 (menuntaskan TO DO 2.1): hitung deduksi dari recipeSnapshot TERSIMPAN
        // via calculateItemDeductions — bukan re-snapshot dari menu/inventori SAAT INI
        // (createSnapshotForCartItems) yang bisa revert 0/salah jika resep berubah atau
        // menu dihapus setelah pending dibuat. Fallback menu.ingredients hanya untuk transaksi lama.
        const menus = useMenuStore.getState().menus;
        const deductions = calculateItemDeductions(tx.items, menus);
        if (Object.keys(deductions).length === 0) return;
        useInventoryStore.getState().revertStock(deductions, `Void Pending #${tx.queueNumber}`);
      },

      getActiveKitchenOrders: () => {
        return get().transactions.filter(
          (t) =>
            t.kitchenStatus !== 'Done' &&
            (t.txStatus === 'Selesai' || t.txStatus === 'Pending')
        );
      },

      clearKdsDoneOrders: () => set({ lastKdsClearTime: new Date().toISOString() }),

      loadFromCloud: (cloudTransactions: Transaction[], fullSync = false) => {
        set((s) => {
          // v4.5 TO DO 6.5: transaksi yang dihapus/rollback lokal tidak boleh re-hidrasi dari cloud (anti ghost)
          const cloudAllIds = new Set(cloudTransactions.map((t) => t.id));
          const cloudTxFiltered = filterTombstoned(cloudTransactions, s.deletedLocalIds || []);
          // Tombstone yang id-nya SUDAH tidak ada di cloud → penghapusan cloud dikonfirmasi → bersihkan
          const remainingTombstones = pruneConfirmedTombstones(s.deletedLocalIds || [], cloudAllIds);

          const cloudIds = new Set(cloudTxFiltered.map((t: Transaction) => t.id));
          
          // Find the oldest transaction date from the cloud list to establish the sync window boundary
          let oldestCloudTime = 0;
          if (cloudTxFiltered.length > 0) {
            // Since it's sorted descending, the last element is the oldest
            const oldestTx = cloudTxFiltered[cloudTxFiltered.length - 1];
            oldestCloudTime = new Date(oldestTx.date).getTime();
          }

          let localOnly: Transaction[];
          if (fullSync) {
            if (cloudTxFiltered.length === 0) {
              // v4.5 TO DO 6.5 guard: tanpa window otoritatif (fetch kosong / semua tertombstone),
              // JANGAN wipe lokal (oldestCloudTime = 0 akan membuang semua transaksi lokal).
              localOnly = s.transactions;
            } else {
              // Full sync mode (real-time or explicit cloud refresh): cloud is authoritative within the window.
              // Any local transaction newer than or equal to oldestCloudTime that is NOT in cloudIds was deleted on another device.
              localOnly = s.transactions.filter((t) => {
                if (cloudIds.has(t.id)) return false;
                const txTime = new Date(t.date).getTime();
                if (txTime >= oldestCloudTime) return false; // Deleted on cloud
                return true; // Keep older transactions outside the fetched window
              });
            }
          } else {
            localOnly = s.transactions.filter((t) => {
              if (cloudIds.has(t.id)) return false;
              const txTime = new Date(t.date).getTime();
              return txTime < oldestCloudTime;
            });
          }

          // Merge: cloud data (tanpa tombstoned) + local-only data
          const merged = [...cloudTxFiltered, ...localOnly];
          // Sort by date descending (newest first)
          merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          // BUG-02 fix: Recalculate nextQueueNumber from merged data
          // to prevent duplicate queue numbers across devices
          const today = getTodayDateStr();
          const todayTxs = merged.filter((t) => t.date.startsWith(today));
          const maxQueue = todayTxs.reduce((max, t) => Math.max(max, t.queueNumber || 0), 0);
          const newNextQueue = Math.max(s.nextQueueNumber, maxQueue + 1);

          // v4.7 TO DO 13.7 (O-5): id yang ada di cloud terkonfirmasi (badge "Belum Sync" hilang)
          const confirmed = new Set(s.confirmedSyncIds);
          cloudTxFiltered.forEach((t) => confirmed.add(t.id));
          return {
            transactions: merged,
            nextQueueNumber: newNextQueue,
            lastQueueDate: today,
            deletedLocalIds: remainingTombstones,
            confirmedSyncIds: Array.from(confirmed),
          };
        });
      },
    }),
    {
      name: 'rempah-transactions',
      // v4.5 TO DO 6.1 (permanen): IndexedDB — kuota jauh lebih besar dari localStorage.
      // safeStorage tetap di-import untuk partialize/prune yang dipakai storage async ini.
      storage: createJSONStorage(() => idbStorage),
      // v4.5 TO DO 6.1: batasi payload tersimpan lokal (±300 transaksi terbaru / 90 hari, pending selalu dipertahankan)
      // agar localStorage tidak melebihi kuota — data lama tetap aman di cloud & di-merge ulang oleh loadFromCloud.
      partialize: (s) => ({
        transactions: pruneTransactionsForStorage(s.transactions),
        nextQueueNumber: s.nextQueueNumber,
        lastQueueDate: s.lastQueueDate,
        lastKdsClearTime: s.lastKdsClearTime,
        deletedLocalIds: s.deletedLocalIds,
      }),
    }
  )
);
