import { useState, useEffect, useRef } from 'react';
import { useTransactionStore } from '../store/transactionStore';
import { useShiftStore } from '../store/shiftStore';
import { useAuthStore } from '../store/authStore';
import { formatRupiah, formatTime } from '../utils/format';
import { playNewOrderSound, playAlertSound } from '../utils/sound';
import { subscribeToTransactions, unsubscribeChannel, fetchTransactionsFromCloud } from '../lib/cloudSync';
import { isSupabaseConfigured } from '../lib/supabase';
import type { KitchenStatus } from '../types';
import { Clock, Flame, CheckCircle2, ArrowRight, AlertTriangle, Volume2, VolumeX } from 'lucide-react';

const columns: { status: KitchenStatus; label: string; color: string; icon: any }[] = [
  { status: 'Waiting', label: 'Antrean Menunggu', color: 'border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-600/50', icon: Clock },
  { status: 'Processing', label: 'Sedang Diproses', color: 'border-blue-400 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-600/50', icon: Flame },
  { status: 'Done', label: 'Selesai', color: 'border-green-400 bg-green-50 dark:bg-green-950/30 dark:border-green-600/50', icon: CheckCircle2 },
];

const ALERT_THRESHOLD_MS = 5 * 60 * 1000; // 5 menit

export default function Kitchen() {
  const { transactions, updateKitchenStatus, lastKdsClearTime, loadFromCloud } = useTransactionStore();
  const { shifts } = useShiftStore();
  const { currentUser } = useAuthStore();
  const [now, setNow] = useState(Date.now());
  const [isMuted, setIsMuted] = useState(false); // GAP-6 fix: Mute state
  const prevWaitingCount = useRef(0);

  // Fetch transactions from cloud on mount + subscribe to real-time updates
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let channel: any;

    const setupSubscription = () => {
      if (channel) unsubscribeChannel(channel);
      channel = subscribeToTransactions((payload: any) => {
        fetchTransactionsFromCloud().then((cloudTx) => {
          if (cloudTx) loadFromCloud(cloudTx, true); // fullSync
        });
      });
    };

    // Initial fetch from cloud
    const fetchData = async () => {
      const cloudTx = await fetchTransactionsFromCloud();
      if (cloudTx && cloudTx.length > 0) {
        loadFromCloud(cloudTx);
      }
    };
    fetchData();
    setupSubscription();

    // Listen to visibilitychange and online events to auto-reconnect (GAP-2 fix)
    const handleReconnect = () => {
      if (document.visibilityState === 'visible' || navigator.onLine) {
        console.log('[KDS] Visibility or online restored, reconnecting subscription...');
        fetchTransactionsFromCloud().then((cloudTx) => {
          if (cloudTx) loadFromCloud(cloudTx, true);
        });
        setupSubscription();
      }
    };

    window.addEventListener('visibilitychange', handleReconnect);
    window.addEventListener('online', handleReconnect);

    return () => {
      if (channel) unsubscribeChannel(channel);
      window.removeEventListener('visibilitychange', handleReconnect);
      window.removeEventListener('online', handleReconnect);
    };
  }, []);

  // Update time every 10 seconds for alert calculation
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, []);

  // Filter active orders — only show TODAY's transactions
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeOrders = transactions.filter((t) => {
    if (t.txStatus !== 'Selesai' && t.txStatus !== 'Pending') return false;
    // v4.5 Perbaikan KDS Split Bill: Abaikan sub-bill (transaksi anak/split) agar tidak memicu duplikasi antrean di dapur
    if (t.splitParentId) return false;
    // Only show today's orders
    if (new Date(t.date) < today) return false;
    // Hide Done orders that were cleared
    if (t.kitchenStatus === 'Done' && lastKdsClearTime && new Date(t.date) < new Date(lastKdsClearTime)) {
      return false;
    }
    return true;
  });

  const waitingOrders = activeOrders.filter((t) => t.kitchenStatus === 'Waiting');

  const getWaitingMinutes = (dateStr: string): number => {
    return Math.floor((now - new Date(dateStr).getTime()) / 60000);
  };

  const isOverdue = (dateStr: string): boolean => {
    return (now - new Date(dateStr).getTime()) >= ALERT_THRESHOLD_MS;
  };

  // Count overdue orders
  const overdueCount = activeOrders.filter(
    (t) => t.kitchenStatus === 'Waiting' && isOverdue(t.date)
  ).length;

  // Sound: chime when new order arrives
  useEffect(() => {
    if (waitingOrders.length > prevWaitingCount.current) {
      playNewOrderSound();
    }
    prevWaitingCount.current = waitingOrders.length;
  }, [waitingOrders.length]);

  // Sound: alarm for overdue orders
  useEffect(() => {
    if (overdueCount > 0 && !isMuted) {
      playAlertSound();
    }
  }, [overdueCount, isMuted]);

  // Re-trigger alarm periodically if overdue persists
  useEffect(() => {
    if (overdueCount === 0 || isMuted) return;
    const interval = setInterval(() => {
      if (overdueCount > 0 && !isMuted) playAlertSound();
    }, 30000);
    return () => clearInterval(interval);
  }, [overdueCount, isMuted]);

  const getNextStatus = (current: KitchenStatus): KitchenStatus | null => {
    if (current === 'Waiting') return 'Processing';
    if (current === 'Processing') return 'Done';
    return null;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-center sm:text-left w-full sm:w-auto">🍳 Kitchen Display System</h1>
        <div className="flex items-center gap-2 justify-center w-full sm:w-auto">
          {overdueCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-950/50 border border-red-300 dark:border-red-700 rounded-xl animate-pulse">
              <AlertTriangle size={18} className="text-red-650" />
              <span className="text-sm font-bold text-red-750 dark:text-red-400">
                {overdueCount} pesanan menunggu &gt; 5 menit!
              </span>
            </div>
          )}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
              isMuted
                ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
                : 'bg-brand-50 dark:bg-brand-950/20 border-brand-200 dark:border-brand-900 text-brand-700 dark:text-brand-400 hover:bg-brand-100/50 dark:hover:bg-brand-900/30'
            }`}
            title={isMuted ? 'Nyalakan alarm' : 'Senyapkan alarm'}
          >
            {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            {isMuted ? 'Alarm Muted' : 'Mute Alarm'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 min-h-0">
        {columns.map(({ status, label, color, icon: Icon }) => {
          const orders = activeOrders
            .filter((t) => t.kitchenStatus === status)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // oldest first
          return (
            <div key={status} className={`rounded-2xl border-2 ${color} flex flex-col min-h-0`}>
              <div className="p-4 flex items-center gap-2">
                <Icon size={20} />
                <h2 className="font-bold text-lg">{label}</h2>
                <span className="badge bg-white/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 ml-auto">{orders.length}</span>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {orders.map((order) => {
                  const overdue = status === 'Waiting' && isOverdue(order.date);
                  const waitMins = getWaitingMinutes(order.date);

                  return (
                    <div
                      key={order.id}
                      className={`rounded-xl p-4 shadow-sm transition-all ${
                        overdue
                          ? 'bg-red-50 dark:bg-red-950/40 border-2 border-red-300 dark:border-red-700 animate-pulse'
                          : 'bg-white dark:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-extrabold text-brand-700 dark:text-brand-400">
                            #{order.queueNumber}
                          </span>
                          {overdue && (
                            <span className="badge bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-400 text-xs">
                              <AlertTriangle size={10} /> {waitMins} mnt
                            </span>
                          )}
                          {status === 'Waiting' && !overdue && (
                            <span className="text-xs text-slate-400">{waitMins} mnt</span>
                          )}
                        </div>
                        {getNextStatus(status) && (
                          <button
                            onClick={() =>
                              updateKitchenStatus(order.id, getNextStatus(status)!)
                            }
                            className={`btn-primary text-xs py-1.5 px-3 ${
                              overdue ? 'animate-bounce' : ''
                            }`}
                          >
                            <ArrowRight size={14} />
                            {status === 'Waiting' ? 'Proses' : 'Selesai'}
                          </button>
                        )}
                      </div>

                      {/* Shift/Cashier info */}
                      <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">
                        {formatTime(order.date)} • {order.cashierName}
                        {order.orderType && (
                          <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            order.orderType === 'Take Away'
                              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                              : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                          }`}>
                            {order.orderType === 'Take Away' ? '📦' : '🍽️'} {order.orderType}{order.tableNumber ? ` (${order.tableNumber})` : ''}
                          </span>
                        )}
                      </p>

                      <div className="space-y-2">
                        {order.items.filter((item) => !item.isBundle).map((item) => (
                          <div key={item.lineId} className="border-l-4 border-brand-300 dark:border-brand-600 pl-3">
                            <p className="font-bold text-base dark:text-slate-100">{item.name}</p>
                            <p className="text-sm text-slate-600 dark:text-slate-400 font-semibold">
                              {item.showTemperature !== false ? item.temperature : ''}{item.showTemperature !== false && item.showSugarLevel !== false ? ' • ' : ''}{item.showSugarLevel !== false ? `Gula ${item.sugar}` : ''}{(item.showTemperature !== false || item.showSugarLevel !== false) ? ' • ' : ''}x{item.quantity}
                            </p>
                            {item.addons.length > 0 && (
                              <p className="text-xs text-slate-500">
                                + {item.addons.map((a) => a.name).join(', ')}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {orders.length === 0 && (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    Tidak ada pesanan
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
