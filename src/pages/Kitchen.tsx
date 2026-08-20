import { useState, useEffect, useRef } from 'react';
import { useTransactionStore } from '../store/transactionStore';
import { useShiftStore } from '../store/shiftStore';
import { useAuthStore } from '../store/authStore';
import { formatRupiah, formatTime } from '../utils/format';
import { isSplitSubBill } from '../utils/splitAllocation';
import { playNewOrderSound, playAlertSound } from '../utils/sound';
import { subscribeToTransactions, unsubscribeChannel, fetchTransactionsFromCloud } from '../lib/cloudSync';
import { isSupabaseConfigured } from '../lib/supabase';
import { useSettingsStore } from '../store/settingsStore';
import { usePrinterCrossTab } from '../hooks/usePrinterCrossTab';
import type { KitchenStatus } from '../types';
import { Clock, Flame, CheckCircle2, ArrowRight, AlertTriangle, Volume2, VolumeX, Printer, RefreshCw, Sparkles, Plus } from 'lucide-react';

const columns: { status: KitchenStatus; label: string; color: string; icon: any }[] = [
  { status: 'Waiting', label: 'Antrean Menunggu', color: 'border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-600/50', icon: Clock },
  { status: 'Processing', label: 'Sedang Diproses', color: 'border-blue-400 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-600/50', icon: Flame },
  { status: 'Done', label: 'Selesai', color: 'border-green-400 bg-green-50 dark:bg-green-950/30 dark:border-green-600/50', icon: CheckCircle2 },
];

const ALERT_THRESHOLD_MS = 5 * 60 * 1000; // 5 menit

export default function Kitchen() {
  const { transactions, updateKitchenStatus, updateItemKitchenStatus, lastKdsClearTime, loadFromCloud } = useTransactionStore();
  const { shifts } = useShiftStore();
  const { currentUser } = useAuthStore();
  const { settings } = useSettingsStore();
  // TO DO 14.4: status koneksi printer dapur lintas-tab (indikator di header KDS)
  const { getStatus, tryReconnectSilent, isLocalConnected } = usePrinterCrossTab();
  const [reconnectingPrinter, setReconnectingPrinter] = useState<string | null>(null);
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
    // v4.8: Pesanan pending yang disimpan dengan "Simpan Tanpa Cetak" (kitchenTicketPrintedAt belum terisi)
    // TIDAK boleh muncul di KDS. KDS hanya menampilkan pesanan pending yang dicetak ke dapur ("Cetak Dapur Saja" / "Cetak Struk Sekarang").
    if (t.txStatus === 'Pending' && !t.kitchenTicketPrintedAt) return false;
    // v4.5 TO DO 5.10 (lanjutan 4.2): Abaikan SEMUA sub-bill split — anak (splitParentId) maupun
    // sub-bill split FRESH (splitIndex terisi tanpa parent, membawa semua item cart dengan kitchenStatus
    // 'Waiting') agar tidak memicu duplikasi antrean di dapur. Tiket dapur split fresh sudah dicetak
    // sekali saat sub-bill pertama sesi dibayar.
    if (isSplitSubBill(t)) return false;
    // Only show today's orders
    if (new Date(t.date) < today) return false;
    // Hide Done orders that were cleared
    if (t.kitchenStatus === 'Done' && lastKdsClearTime && new Date(t.date) < new Date(lastKdsClearTime)) {
      return false;
    }
    return true;
  });

  const waitingOrders = activeOrders.filter((t) => t.kitchenStatus === 'Waiting');

  // v4.7 TO DO 21.5: deteksi pesanan yang di-update (Done → Waiting setelah tambah item)
  // updatedAt > date + 5 detik = order pernah selesai lalu di-reset ke Waiting
  const isUpdatedOrder = (t: { date: string; updatedAt?: string }): boolean => {
    if (!t.updatedAt) return false;
    return new Date(t.updatedAt).getTime() - new Date(t.date).getTime() > 5000;
  };

  // v4.7 TO DO 21.5: waktu referensi untuk overdue & wait — pakai updatedAt jika order di-update
  // (restart timer saat order muncul kembali di KDS setelah Done → Waiting)
  const getWaitingMinutes = (t: { date: string; updatedAt?: string }): number => {
    const refTime = isUpdatedOrder(t) && t.updatedAt ? t.updatedAt : t.date;
    return Math.floor((now - new Date(refTime).getTime()) / 60000);
  };

  const isOverdue = (t: { date: string; updatedAt?: string }): boolean => {
    const refTime = isUpdatedOrder(t) && t.updatedAt ? t.updatedAt : t.date;
    return (now - new Date(refTime).getTime()) >= ALERT_THRESHOLD_MS;
  };

  // Count overdue orders
  const overdueCount = activeOrders.filter(
    (t) => t.kitchenStatus === 'Waiting' && isOverdue(t)
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
          {/* TO DO 14.4: indikator status printer dapur lintas-tab */}
          {(settings.kitchenPrinters || []).filter((kp) => kp.enabled && kp.type === 'bluetooth').length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {(settings.kitchenPrinters || [])
                .filter((kp) => kp.enabled && kp.type === 'bluetooth')
                .map((kp) => {
                  const st = getStatus(kp.id);
                  const connected = st.connected;
                  return (
                    <span
                      key={kp.id}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                        connected
                          ? 'bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400'
                          : 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700 text-red-600 dark:text-red-400'
                      }`}
                      title={connected ? `${kp.name} tersambung` : `${kp.name} terputus — klik ikon untuk coba sambungkan ulang`}
                    >
                      <Printer size={12} />
                      <span className="hidden md:inline max-w-[140px] truncate">{kp.name}</span>
                      {connected ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      ) : (
                        <button
                          onClick={async () => {
                            setReconnectingPrinter(kp.id);
                            await tryReconnectSilent(kp.id);
                            // Status langsung di-refresh via event broadcast / registry
                            setReconnectingPrinter(null);
                          }}
                          disabled={reconnectingPrinter !== null}
                          className="inline-flex items-center gap-1 text-[10px] font-bold hover:underline"
                          title="Coba sambungkan ulang (senyap — tanpa jendela pilih device)"
                        >
                          <RefreshCw size={10} className={reconnectingPrinter === kp.id ? 'animate-spin' : ''} />
                          <span className="hidden sm:inline">{reconnectingPrinter === kp.id ? 'Menghubungkan...' : 'Hubungkan'}</span>
                        </button>
                      )}
                    </span>
                  );
                })}
            </div>
          )}
          {overdueCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-950/50 border border-red-300 dark:border-red-700 rounded-xl animate-pulse">
              <AlertTriangle size={18} className="text-red-500" />
              <span className="text-sm font-bold text-red-700 dark:text-red-400">
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
          // v4.8 TO DO 23.4 + FIX 24.5: filter orders berdasarkan kitchenItemStatus per-item
          // v4.8 FIX 25.3: transaksi muncul di kolom DOMINAN saja (tidak muncul di 2 kolom)
          // Priority: Waiting (ada 'new') > Processing (ada 'processing') > Done (semua 'done')
          const orders = activeOrders
            .filter((t) => {
              const hasKitchenItemStatus = t.items.some((i) => i.kitchenItemStatus);
              
              if (!hasKitchenItemStatus) {
                // Legacy order tanpa kitchenItemStatus → pakai kitchenStatus transaksi
                return t.kitchenStatus === status;
              }
              
              const allDone = t.items.filter((i) => !i.isBundle).every((i) => i.kitchenItemStatus === 'done');
              const hasNew = t.items.some((i) => i.kitchenItemStatus === 'new');
              const hasProcessing = t.items.some((i) => i.kitchenItemStatus === 'processing');
              
              // Tentukan status dominan (hanya 1 kolom)
              let effectiveStatus: 'Waiting' | 'Processing' | 'Done';
              if (allDone) effectiveStatus = 'Done';
              else if (hasNew) effectiveStatus = 'Waiting';
              else if (hasProcessing) effectiveStatus = 'Processing';
              else effectiveStatus = 'Done'; // fallback
              
              return effectiveStatus === status;
            })
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // oldest first
          return (
            <div key={status} className={`rounded-2xl border-2 ${color} flex flex-col min-h-0`}>
              <div className="p-4 flex items-center gap-2">
                <Icon size={20} />
                <h2 className="font-bold text-lg">{label}</h2>
                <span className="badge bg-white/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 ml-auto">{orders.length}</span>
                {/* v4.8 TO DO 23.5: shortcut 'Proses Semua' / 'Selesai Semua' */}
                {status === 'Waiting' && orders.length > 0 && (
                  <button
                    onClick={() => {
                      orders.forEach((o) => {
                        o.items.filter((i) => !i.isBundle && i.kitchenItemStatus === 'new').forEach((i) => {
                          updateItemKitchenStatus(o.id, i.lineId, 'processing');
                        });
                      });
                    }}
                    className="text-[10px] px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 transition font-semibold"
                  >
                    <Flame size={10} className="inline mr-0.5" />Proses Semua
                  </button>
                )}
                {status === 'Processing' && orders.length > 0 && (
                  <button
                    onClick={() => {
                      orders.forEach((o) => {
                        // v4.8 FIX 24.2: hanya tandai item 'processing' (bukan 'new') sebagai done
                        o.items.filter((i) => !i.isBundle && i.kitchenItemStatus === 'processing').forEach((i) => {
                          updateItemKitchenStatus(o.id, i.lineId, 'done');
                        });
                      });
                    }}
                    className="text-[10px] px-2 py-1 rounded bg-green-100 dark:bg-green-900/60 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800 transition font-semibold"
                  >
                    <CheckCircle2 size={10} className="inline mr-0.5" />Selesai Semua
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {orders.map((order) => {
                  const updated = isUpdatedOrder(order);
                  const overdue = status === 'Waiting' && isOverdue(order);
                  const waitMins = getWaitingMinutes(order);

                  return (
                    <div
                      key={order.id}
                      className={`rounded-xl p-4 shadow-sm transition-all ${
                        overdue
                          ? 'bg-red-50 dark:bg-red-950/40 border-2 border-red-300 dark:border-red-700 animate-pulse'
                          : updated
                            ? 'bg-blue-50/60 dark:bg-blue-950/30 border-2 border-blue-300 dark:border-blue-600/60'
                            : 'bg-white dark:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-extrabold text-brand-700 dark:text-brand-400">
                            #{order.queueNumber}
                          </span>
                          {/* v4.7 TO DO 21.5: badge '🔄 Diupdate' untuk pesanan yang di-update (Done → Waiting) */}
                          {updated && status === 'Waiting' && (
                            <span className="badge bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-400 text-xs font-semibold">
                              🔄 Diupdate
                            </span>
                          )}
                          {overdue && (
                            <span className="badge bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-400 text-xs">
                              <AlertTriangle size={10} /> {waitMins} mnt
                            </span>
                          )}
                          {status === 'Waiting' && !overdue && !updated && (
                            <span className="text-xs text-slate-400">{waitMins} mnt</span>
                          )}
                          {status === 'Waiting' && !overdue && updated && (
                            <span className="text-xs text-blue-400">{waitMins} mnt (sejak update)</span>
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
                        {/* v4.8 FIX 24.5: filter item berdasarkan kolom saat ini */}
                        {order.items.filter((item) => {
                          if (item.isBundle) return false;
                          const itemStatus = item.kitchenItemStatus || 'new';
                          // Di kolom Waiting: hanya tampilkan item 'new'
                          if (status === 'Waiting') return itemStatus === 'new';
                          // Di kolom Processing: hanya tampilkan item 'processing'
                          if (status === 'Processing') return itemStatus === 'processing';
                          // Di kolom Done: tampilkan SEMUA item (termasuk yang done)
                          return true;
                        }).map((item) => {
                          // v4.8 TO DO 23.1: badge per-item berdasarkan kitchenItemStatus
                          const itemStatus = item.kitchenItemStatus || 'new';
                          const isDone = itemStatus === 'done';
                          const isNew = itemStatus === 'new';
                          return (
                            <div
                              key={item.lineId}
                              className={`border-l-4 pl-3 py-1 rounded-r-lg transition-all ${
                                isDone
                                  ? 'border-green-400 dark:border-green-600 bg-green-50/50 dark:bg-green-950/20 opacity-70'
                                  : isNew
                                    ? 'border-amber-400 dark:border-amber-600 bg-amber-50/50 dark:bg-amber-950/20'
                                    : 'border-blue-400 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/20'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <p className={`font-bold text-base dark:text-slate-100 ${isDone ? 'line-through text-slate-500 dark:text-slate-400' : ''}`}>
                                  {item.name}
                                </p>
                                {/* v4.8: badge status per-item */}
                                {isDone && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 dark:bg-green-900/60 text-green-700 dark:text-green-400">
                                    <CheckCircle2 size={10} /> Selesai
                                  </span>
                                )}
                                {isNew && status === 'Waiting' && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-400">
                                    <Plus size={10} /> Baru
                                  </span>
                                )}
                                {!isDone && !isNew && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-400">
                                    <Flame size={10} /> Diproses
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-600 dark:text-slate-400 font-semibold">
                                {item.showTemperature !== false ? item.temperature : ''}{item.showTemperature !== false && item.showSugarLevel !== false ? ' • ' : ''}{item.showSugarLevel !== false ? `Gula ${item.sugar}` : ''}{(item.showTemperature !== false || item.showSugarLevel !== false) ? ' • ' : ''}x{item.quantity}
                              </p>
                              {item.addons.length > 0 && (
                                <p className="text-xs text-slate-500">
                                  + {item.addons.map((a) => a.name).join(', ')}
                                </p>
                              )}
                              {/* v4.8 TO DO 23.5: tombol per-item untuk transisi status */}
                              {!isDone && (
                                <div className="flex gap-1 mt-1">
                                  {isNew && (
                                    <button
                                      onClick={() => updateItemKitchenStatus(order.id, item.lineId, 'processing')}
                                      className="text-[10px] px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 transition"
                                    >
                                      <Flame size={10} className="inline mr-0.5" />Proses
                                    </button>
                                  )}
                                  {!isNew && (
                                    <button
                                      onClick={() => updateItemKitchenStatus(order.id, item.lineId, 'done')}
                                      className="text-[10px] px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/60 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800 transition"
                                    >
                                      <CheckCircle2 size={10} className="inline mr-0.5" />Selesai
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* v4.7 TO DO 21.5: catatan untuk pesanan yang di-update */}
                      {updated && status === 'Waiting' && (
                        <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-2 pt-2 border-t border-blue-200 dark:border-blue-700/40 italic">
                          🔄 Pesanan diperbarui — periksa item baru di atas
                        </p>
                      )}
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
