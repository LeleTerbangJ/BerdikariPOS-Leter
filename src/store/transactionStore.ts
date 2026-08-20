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
import { syncTransaction, syncTransactionStatus, syncTransactionTxStatus, syncTransactionMeta, deleteTransactionCloud, fetchMaxQueueNumberCloud, allocateQueueNumberCloud } from '../lib/cloudSync';
import { localMaxQueueNumber, toLocalDateKey } from '../utils/queueNumber';
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
  // v4.8 TO DO 23.5: update kitchenItemStatus per-item di transaksi
  updateItemKitchenStatus: (txId: string, lineId: string, status: 'new' | 'processing' | 'done') => void;
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

        // FLOOR: nomor tertinggi yang sudah terpakai (cloud vs lokal) — alokasi tidak boleh
        // menabrak transaksi yang sudah ada (data lama / device lain yang belum pakai RPC).
        let floor = localMaxQueueNumber(get().transactions, today);
        const cloudMax = await fetchMaxQueueNumberCloud(today); // 0 bila offline / tidak dikonfigurasi
        floor = Math.max(floor, cloudMax);

        // v4.7 TO DO 18.2 (Prioritas 18): alokasi ATOMIK dari counter cloud via RPC
        // `allocate_queue_number` (row-lock upsert) — dua kasir ONLINE tidak bisa mendapat
        // nomor antrean yang sama (sebelumnya check-then-act → #N kembar).
        const allocated = await allocateQueueNumberCloud(today, floor);
        if (allocated !== null && allocated > 0) return allocated;

        // Fallback lokal (offline / RPC belum dibuat di DB — flag queueCounterRpc):
        // masih bisa duplikat lintas device (batasan TO DO 13.6 / O-6); duplikat yang
        // terlanjur dibuat DIDETEKSI setelah merge (badge "#N duplikat" di Riwayat
        // Transaksi & Pending Payments via findDuplicateQueueNumbers).
        return floor + 1;
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
          // v4.7 TO DO 18.3: bandingkan TANGGAL LOKAL (bukan prefix UTC) — transaksi
          // jam 00:00–07:00 WIB (UTC = tanggal sebelumnya) tidak boleh terlewat dari hitungan.
          const todayTxs = nextList.filter(
            (t) => toLocalDateKey(t.date) === today && t.txStatus !== 'Demo' && t.txStatus !== 'Cancel'
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
            // v4.7 (evaluasi updatedAt): stamp mutasi — jalur ini TIDAK mengubah `date`
            // (timestamp bisnis), jadi freshness harus dicatat terpisah agar update lokal
            // tidak kalah dari fetch cloud stale saat smartUpdate async belum selesai.
            t.id === id ? { ...t, kitchenStatus: status, updatedAt: new Date().toISOString() } : t
          ),
        }));
      },

      // v4.8 TO DO 23.5: update kitchenItemStatus per-item di transaksi
      updateItemKitchenStatus: (txId, lineId, status) => {
        let updatedTx: Transaction | undefined;
        set((s) => ({
          transactions: s.transactions.map((t) => {
            if (t.id !== txId) return t;
            const updatedItems = t.items.map((item) =>
              item.lineId === lineId ? { ...item, kitchenItemStatus: status } : item
            );
            // Hitung effective kitchenStatus berdasarkan item status
            const allDone = updatedItems.filter((i) => !i.isBundle).every((i) => i.kitchenItemStatus === 'done');
            const hasNew = updatedItems.some((i) => i.kitchenItemStatus === 'new');
            const hasProcessing = updatedItems.some((i) => i.kitchenItemStatus === 'processing');
            let newKitchenStatus = t.kitchenStatus;
            if (allDone) newKitchenStatus = 'Done';
            else if (hasNew) newKitchenStatus = 'Waiting';
            else if (hasProcessing) newKitchenStatus = 'Processing';
            updatedTx = { ...t, items: updatedItems, kitchenStatus: newKitchenStatus, updatedAt: new Date().toISOString() };
            return updatedTx;
          }),
        }));
        // v4.8 TO DO 23.6: sync ke cloud — kitchenStatus + items (dengan kitchenItemStatus)
        if (updatedTx) {
          syncTransactionStatus(txId, updatedTx.kitchenStatus);
          syncTransactionMeta(txId, { items: updatedTx.items } as any);
        }
      },

      updateTxStatus: (id, status) => {
        syncTransactionTxStatus(id, status); // Cloud sync
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id
              ? { ...t, txStatus: status, isPending: status === 'Pending', updatedAt: new Date().toISOString() }
              : t
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
            t.id === id ? { ...t, ...partial, updatedAt: new Date().toISOString() } : t
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

          // v4.7 FIX (bug: item pending tidak ter-update di riwayat transaksi):
          // re-commit pending dengan ID yang sama men-stamp date baru di engine → update lokal
          // SELALU lebih baru dari versi cloud sebelum upsert async selesai (atau bila upsert
          // tertunda/gagal → offline queue). Sebelumnya loadFromCloud cloud-authoritative tanpa
          // perbandingan freshness → fetch realtime/refresh dengan data cloud STALE menimpa
          // item lokal yang sudah benar (menu yang ditambah/dikurangi hilang dari riwayat).
          // Kini: bila ID ada di cloud DAN di lokal → pilih yang lebih baru (date).
          // Deletion lintas device (ID lokal TIDAK ada di cloud, di dalam window) tetap
          // cloud-authoritative seperti sebelumnya.
          // v4.7 (evaluasi updatedAt): freshness marker utamakan `updatedAt` (timestamp mutasi),
          // fallback `date` untuk baris legacy yang belum punya updatedAt. Ini menutup race
          // untuk SEMUA jalur update — termasuk status (void/cancel) & meta (paymentMethod/
          // refund) yang TIDAK mengubah `date` (timestamp bisnis untuk laporan & filter).
          const freshTime = (tx: Transaction): number =>
            new Date((tx.updatedAt as string | undefined) || tx.date).getTime();
          const keepLocalIfNewer = (t: Transaction): boolean => {
            if (!cloudIds.has(t.id)) return false;
            const cloudTx = cloudTxFiltered.find((c) => c.id === t.id);
            if (!cloudTx) return false;
            return freshTime(t) > freshTime(cloudTx);
          };

          // v4.7: ID yang versi LOKAL-nya lebih baru dari cloud → versi cloud TIDAK boleh
          // ikut merge. Jika ikut, muncul dua record ber-ID sama (duplikat baris di UI) dan
          // `find()`/sort bisa mengembalikan versi cloud stale sebagai pemenang.
          const localNewerIds = new Set(
            s.transactions
              .filter((t) => cloudIds.has(t.id) && keepLocalIfNewer(t))
              .map((t) => t.id)
          );
          const cloudForMerge = cloudTxFiltered.filter((c) => !localNewerIds.has(c.id));

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
                if (cloudIds.has(t.id)) return keepLocalIfNewer(t);
                const txTime = new Date(t.date).getTime();
                if (txTime >= oldestCloudTime) return false; // Deleted on cloud
                return true; // Keep older transactions outside the fetched window
              });
            }
          } else {
            localOnly = s.transactions.filter((t) => {
              if (cloudIds.has(t.id)) return keepLocalIfNewer(t);
              const txTime = new Date(t.date).getTime();
              return txTime < oldestCloudTime;
            });
          }

          // Merge: cloud data (tanpa tombstoned & tanpa versi yang kalah dari lokal) + local-only data
          const merged = [...cloudForMerge, ...localOnly];
          // Sort by date descending (newest first)
          merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          // BUG-02 fix: Recalculate nextQueueNumber from merged data
          // to prevent duplicate queue numbers across devices
          const today = getTodayDateStr();
          // v4.7 TO DO 18.3: tanggal LOKAL (bukan prefix UTC) — konsisten dengan floor
          // localMaxQueueNumber & counter cloud per tanggal lokal.
          const todayTxs = merged.filter((t) => toLocalDateKey(t.date) === today);
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
