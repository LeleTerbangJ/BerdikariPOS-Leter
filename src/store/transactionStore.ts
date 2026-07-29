import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Transaction, KitchenStatus, TxStatus } from '../types';
import { syncTransaction, syncTransactionStatus, syncTransactionTxStatus, deleteTransactionCloud } from '../lib/cloudSync';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface TransactionState {
  transactions: Transaction[];
  nextQueueNumber: number;
  lastQueueDate: string | null;
  lastKdsClearTime: string | null;
  addTransaction: (tx: Transaction) => void;
  updateKitchenStatus: (id: string, status: KitchenStatus) => void;
  updateTxStatus: (id: string, status: TxStatus) => void;
  deleteTransaction: (id: string) => void;
  deleteTransactionLocal: (id: string) => void;
  getTodayTransactions: () => Transaction[];
  getActiveKitchenOrders: () => Transaction[];
  clearKdsDoneOrders: () => void;
  getNextQueueNumber: () => Promise<number>;
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
        const todayTxs = get().transactions.filter(
          (t) => t.date.startsWith(today) && t.txStatus !== 'Demo' && t.txStatus !== 'Cancel'
        );
        const maxQueue = todayTxs.reduce((max, t) => Math.max(max, t.queueNumber || 0), 0);
        return maxQueue + 1;
      },

      addTransaction: (tx) => {
        syncTransaction(tx); // Cloud sync
        set((s) => {
          const today = getTodayDateStr();
          const todayTxs = [tx, ...s.transactions].filter(
            (t) => t.date.startsWith(today) && t.txStatus !== 'Demo' && t.txStatus !== 'Cancel'
          );
          const maxQueue = todayTxs.reduce((max, t) => Math.max(max, t.queueNumber || 0), 0);
          return {
            transactions: [tx, ...s.transactions],
            nextQueueNumber: maxQueue + 1,
            lastQueueDate: today,
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
            t.id === id ? { ...t, txStatus: status } : t
          ),
        }));
      },

      deleteTransaction: (id) => {
        deleteTransactionCloud(id); // Cloud sync
        set((s) => ({
          transactions: s.transactions.filter((t) => t.id !== id),
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

      getActiveKitchenOrders: () => {
        return get().transactions.filter(
          (t) =>
            t.kitchenStatus !== 'Done' &&
            t.txStatus === 'Selesai'
        );
      },

      clearKdsDoneOrders: () => set({ lastKdsClearTime: new Date().toISOString() }),

      loadFromCloud: (cloudTransactions, fullSync = false) => {
        set((s) => {
          const cloudIds = new Set(cloudTransactions.map((t) => t.id));
          
          // Find the oldest transaction date from the cloud list to establish the sync window boundary
          let oldestCloudTime = 0;
          if (cloudTransactions.length > 0) {
            // Since it's sorted descending, the last element is the oldest
            const oldestTx = cloudTransactions[cloudTransactions.length - 1];
            oldestCloudTime = new Date(oldestTx.date).getTime();
          }

          let localOnly: Transaction[];
          if (fullSync) {
            // Full sync mode (real-time or explicit cloud refresh): cloud is authoritative within the window.
            // Any local transaction newer than or equal to oldestCloudTime that is NOT in cloudIds was deleted on another device.
            localOnly = s.transactions.filter((t) => {
              if (cloudIds.has(t.id)) return false;
              const txTime = new Date(t.date).getTime();
              if (txTime >= oldestCloudTime) return false; // Deleted on cloud
              return true; // Keep older transactions outside the fetched window
            });
          } else {
            localOnly = s.transactions.filter((t) => {
              if (cloudIds.has(t.id)) return false;
              const txTime = new Date(t.date).getTime();
              return txTime < oldestCloudTime;
            });
          }

          // Merge: cloud data + local-only data
          const merged = [...cloudTransactions, ...localOnly];
          // Sort by date descending (newest first)
          merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          // BUG-02 fix: Recalculate nextQueueNumber from merged data
          // to prevent duplicate queue numbers across devices
          const today = getTodayDateStr();
          const todayTxs = merged.filter((t) => t.date.startsWith(today));
          const maxQueue = todayTxs.reduce((max, t) => Math.max(max, t.queueNumber || 0), 0);
          const newNextQueue = Math.max(s.nextQueueNumber, maxQueue + 1);

          return {
            transactions: merged,
            nextQueueNumber: newNextQueue,
            lastQueueDate: today,
          };
        });
      },
    }),
    { name: 'rempah-transactions' }
  )
);
