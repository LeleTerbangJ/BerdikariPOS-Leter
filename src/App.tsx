import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { useShiftStore } from './store/shiftStore';
import { useStockLogStore } from './store/stockLogStore';
import { useAuditLogStore } from './store/auditLogStore';
import { useSettingsStore } from './store/settingsStore';
import { useCustomerStore } from './store/customerStore';
import { useTransactionStore } from './store/transactionStore';
import { useMenuStore } from './store/menuStore';
import { useInventoryStore } from './store/inventoryStore';
import { usePromoStore } from './store/promoStore';
import { useStockOpnameStore } from './store/stockOpnameStore';
import { useCashMovementStore } from './store/cashMovementStore';
import { useToastStore } from './store/toastStore';
import { updateFavicon, updatePageTitle } from './utils/favicon';
import { hexToRgbValues } from './utils/theme';
import { initOfflineQueue } from './lib/offlineQueue';
import { isSupabaseConfigured } from './lib/supabase';
import { fetchTransactionsFromCloud, runMigrations, subscribeToUsers, subscribeToSettings, subscribeToMenus, subscribeToInventory, subscribeToCashMovements, subscribeToShifts, subscribeToTransactions, subscribeToCustomers, subscribeToPromos, subscribeToStockOpnames, unsubscribeChannel, mapCloudRowToTransaction } from './lib/cloudSync';
import { startAutoBackupScheduler, stopAutoBackupScheduler } from './lib/autoBackupScheduler';
import Layout from './components/Layout';
import OpenShiftModal from './components/OpenShiftModal';
import ToastContainer from './components/ToastContainer';
import Login from './pages/Login';
import ErrorBoundary from './components/ErrorBoundary';

const POS = lazy(() => import('./pages/POS'));
const Kitchen = lazy(() => import('./pages/Kitchen'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Catalog = lazy(() => import('./pages/Catalog'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Reports = lazy(() => import('./pages/Reports'));
const Customers = lazy(() => import('./pages/Customers'));
const Promos = lazy(() => import('./pages/Promos'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const CashMovements = lazy(() => import('./pages/CashMovements'));

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { currentUser } = useAuthStore();
  if (!currentUser) return <Navigate to="/" replace />;
  if (allowedRoles && !allowedRoles.includes(currentUser.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function ShiftGuard({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuthStore();
  const { activeShift } = useShiftStore();
  const location = useLocation();

  // ROADMAP-1: Manager only opens shift when they click POS menu (on '/pos' route)
  const isPosPath = location.pathname === '/pos';
  const needsShift = currentUser && (
    (currentUser.role === 'Kasir') || 
    (currentUser.role === 'Manager' && isPosPath)
  ) && !activeShift;

  return (
    <>
      {needsShift && <OpenShiftModal open={true} />}
      {children}
    </>
  );
}

// v4.5 TO DO 6.1 (permanen): storage transactions & audit-logs kini IndexedDB (ASYNC hydrasi).
// Middleware persist melakukan set(stateFromStorage, true) SETELAH promise getItem resolve —
// jika loadFromCloud (network) selesai lebih dulu, hasil merge cloud bisa TERTIMPA snapshot persist.
// Helper ini menunggu hydrasi selesai sebelum load cloud dijalankan (deterministik, tidak ada race).
function whenHydrated<S>(
  store: { persist?: { hasHydrated: () => boolean; onFinishHydration: (cb: (s?: S) => void) => () => void } }
): Promise<void> {
  const p = store.persist;
  if (!p) return Promise.resolve();
  if (p.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    p.onFinishHydration(() => resolve());
  });
}

export default function App() {
  const { currentUser, migratePasswords } = useAuthStore();
  const { settings } = useSettingsStore();

  // Apply dynamic theme settings to root element
  useEffect(() => {
    const shades = (settings.themeShades && Object.keys(settings.themeShades).length > 0)
      ? settings.themeShades
      : {
          50: '#fdf8f3',
          100: '#f9ebd9',
          200: '#f2d4ae',
          300: '#e9b67a',
          400: '#de9348',
          500: '#d17a2a',
          600: '#b85f21',
          700: '#94481f',
          800: '#763b20',
          900: '#60311d',
        };

    const root = document.documentElement;
    Object.entries(shades).forEach(([shade, hex]) => {
      try {
        const rgbStr = hexToRgbValues(hex);
        root.style.setProperty(`--brand-${shade}`, rgbStr);
      } catch (err) {
        console.error('Failed to set root property for theme:', err);
      }
    });
  }, [settings.themeShades]);

  // Migrate passwords, load cloud data, cleanup old logs, update favicon, init offline queue
  useEffect(() => {
    // BUG-K2 fix: migratePasswords MUST complete before loadFromCloud
    // to prevent cloud plain-text passwords from overwriting local hashed ones
    migratePasswords();
    initOfflineQueue();
    // v4.7 TO DO 7.6: scheduler auto backup (guard frequency/targetTime/online di dalam modul)
    startAutoBackupScheduler();

    // Load all shared data from cloud (fullSync=true: cloud is authoritative at boot)
    useSettingsStore.getState().loadFromCloud().then(() => {
      const s = useSettingsStore.getState().settings;
      updateFavicon(s.storeLogo);
      updatePageTitle(s.storeName);
    });
    // Run database migrations first, then load cloud data
    runMigrations().then(() => {
      useMenuStore.getState().loadFromCloud(true);
    });
    useCustomerStore.getState().loadFromCloud(true);
    useInventoryStore.getState().loadFromCloud(true);
    // BUG-K2 fix: Load auth from cloud AFTER migratePasswords has set passwordsHashed=true
    // migratePasswords is synchronous, so by this point local passwords are already hashed
    useAuthStore.getState().loadFromCloud(true);
    usePromoStore.getState().loadFromCloud(true);
    // BUG-C3 fix: Load shifts from cloud
    useShiftStore.getState().loadFromCloud();
    useStockOpnameStore.getState().loadFromCloud();
    useCashMovementStore.getState().loadFromCloud(true);
    // v4.5 TO DO 6.1 (permanen): tunggu hydrasi IndexedDB selesai sebelum merge cloud,
    // agar snapshot persist tidak menimpa transaksi cloud yang baru di-fetch (race async).
    whenHydrated(useTransactionStore).then(() => {
      fetchTransactionsFromCloud().then((txs) => {
        if (txs && txs.length > 0) useTransactionStore.getState().loadFromCloud(txs, true);
      });
    });

    const txChannel = subscribeToTransactions((payload: any) => {
      if (payload?.eventType === 'DELETE' && payload.old?.id) {
        useTransactionStore.getState().deleteTransactionLocal(payload.old.id);
      } else if (payload?.new) {
        const tx = mapCloudRowToTransaction(payload.new);
        useTransactionStore.getState().upsertTransactionFromRealtime(tx);
      }
    });

    // Cleanup old logs, then load from cloud
    // BUG-C4 fix: Load stock logs and audit logs from cloud
    useStockLogStore.getState().clearOldLogs(30);
    useStockLogStore.getState().loadFromCloud();
    // v4.5 TO DO 6.1 (permanen): audit-logs kini IndexedDB (async) — clear/load cloud
    // dijalankan setelah hydrasi selesai agar tidak tertimpa snapshot persist.
    whenHydrated(useAuditLogStore).then(() => {
      useAuditLogStore.getState().clearOldLogs(90);
      useAuditLogStore.getState().loadFromCloud();
    });

    return () => {
      if (txChannel) unsubscribeChannel(txChannel);
      stopAutoBackupScheduler();
    };
  }, []);

  // Subscribe to realtime users table changes to prevent multi-device logins
  // Subscribe to realtime changes across tables (global single subscriptions)
  // Subscribe to realtime changes across tables (global single subscriptions)
  useEffect(() => {
    if (!currentUser || !isSupabaseConfigured) return;

    let userChannel: any;
    let settingsChannel: any;
    let menuChannel: any;
    let inventoryChannel: any;
    let cashMovementChannel: any;
    let shiftChannel: any;
    let customerChannel: any;
    let promoChannel: any;
    let stockOpnameChannel: any;

    const cleanupSubscriptions = () => {
      if (userChannel) unsubscribeChannel(userChannel);
      if (settingsChannel) unsubscribeChannel(settingsChannel);
      if (menuChannel) unsubscribeChannel(menuChannel);
      if (inventoryChannel) unsubscribeChannel(inventoryChannel);
      if (cashMovementChannel) unsubscribeChannel(cashMovementChannel);
      if (shiftChannel) unsubscribeChannel(shiftChannel);
      if (customerChannel) unsubscribeChannel(customerChannel);
      if (promoChannel) unsubscribeChannel(promoChannel);
      if (stockOpnameChannel) unsubscribeChannel(stockOpnameChannel);
    };

    const setupSubscriptions = () => {
      cleanupSubscriptions();

      userChannel = subscribeToUsers((payload: any) => {
        // Multi-device login check & deletion check
        if (payload?.eventType === 'DELETE' && payload.old?.id === currentUser.id) {
          useToastStore.getState().addToast('Akun Anda telah dinonaktifkan.', 'error');
          useAuthStore.getState().logout();
          window.location.href = '/';
          return;
        }

        if (payload.new && payload.new.id === currentUser.id) {
          const localActiveSessionId = currentUser.activeSessionId;
          const newActiveSessionId = payload.new.active_session_id;

          // If there's a different session ID active in cloud, log out local session
          if (newActiveSessionId && localActiveSessionId && newActiveSessionId !== localActiveSessionId) {
            useToastStore.getState().addToast('Akun Anda telah masuk di perangkat lain. Sesi ini akan ditutup.', 'warning');
            useAuthStore.getState().logout();
            window.location.href = '/';
            return;
          }
        }

        // EGRESS-OPT: Hanya sinkronisasi ulang tabel users jika ada mutasi kredensial/role/user baru/penghapusan.
        // Bandingkan payload.new dengan data user lokal di authStore (bukan payload.old, karena default Postgres
        // REPLICA IDENTITY hanya mengirim primary key pada payload.old).
        const existingUsers = useAuthStore.getState().users;
        const targetUser = existingUsers.find((u) => u.id === (payload.new?.id || payload.old?.id));

        const isAuthCredentialMutation =
          payload?.eventType === 'DELETE' ||
          (payload?.eventType === 'INSERT' && !existingUsers.some((u) => u.id === payload.new?.id)) ||
          (payload?.new && targetUser && (
            payload.new.username !== targetUser.username ||
            payload.new.role !== targetUser.role ||
            payload.new.password !== targetUser.password ||
            payload.new.name !== targetUser.name
          ));

        if (isAuthCredentialMutation) {
          useAuthStore.getState().loadFromCloud(true);
        }
      });

      // Realtime settings subscription: sync Manager PIN & app settings immediately across devices
      settingsChannel = subscribeToSettings(() => {
        useSettingsStore.getState().loadFromCloud();
      });

      // Global Realtime subscription for menus across all devices
      menuChannel = subscribeToMenus(() => {
        useMenuStore.getState().loadFromCloud(true);
      });

      // Global Realtime subscription for inventory across all devices
      inventoryChannel = subscribeToInventory(() => {
        useInventoryStore.getState().loadFromCloud(true);
      });

      // Global Realtime subscription for cash movements (Rekap Kas) across all devices
      cashMovementChannel = subscribeToCashMovements((payload: any) => {
        if (payload?.eventType === 'DELETE' && payload.old?.id) {
          useCashMovementStore.getState().deleteMovementLocal(payload.old.id);
        } else {
          useCashMovementStore.getState().loadFromCloud(true);
        }
      });

      // H.3 Pilar 3 (v4.9.3): Global Realtime subscription untuk shifts — tutup shift
      // (normal / force close Manager) di perangkat mana pun langsung tercermin di semua
      // device. Merge LWW ditangani shiftStore.loadFromCloud (clear activeShift bila versi
      // cloud 'closed' + restore shift terbuka paling awal) — TIDAK ada set mentah.
      shiftChannel = subscribeToShifts(() => {
        useShiftStore.getState().loadFromCloud();
      });

      // EGRESS-OPT: Global Realtime subscription untuk customers across all devices
      customerChannel = subscribeToCustomers(() => {
        useCustomerStore.getState().loadFromCloud(true);
      });

      // EGRESS-OPT: Global Realtime subscription untuk promos across all devices
      promoChannel = subscribeToPromos(() => {
        usePromoStore.getState().loadFromCloud(true);
      });

      // EGRESS-OPT: Global Realtime subscription untuk stock_opnames across all devices
      stockOpnameChannel = subscribeToStockOpnames(() => {
        useStockOpnameStore.getState().loadFromCloud();
      });
    };

    setupSubscriptions();

    // EGRESS-OPT: visibilitychange handler dengan debounce + channel state check + channel re-subscribe.
    // Hanya fetch ulang jika ada channel Realtime yang terputus (WebSocket tertidur/mati saat tab idle/background).
    // Jika semua channel masih 'joined', tidak perlu fetch ulang (menghemat egress dari burst tab switching).
    let lastReconnect = 0;
    const RECONNECT_DEBOUNCE_MS = 5000;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastReconnect < RECONNECT_DEBOUNCE_MS) return;
      lastReconnect = now;

      const channels = [
        userChannel,
        settingsChannel,
        menuChannel,
        inventoryChannel,
        cashMovementChannel,
        shiftChannel,
        customerChannel,
        promoChannel,
        stockOpnameChannel,
      ];

      // Channel dianggap putus jika statusnya jelas 'closed'/'errored', ATAU jika pernah terhubung (joinedOnce)
      // tetapi sekarang tidak lagi 'joined'. Status 'joining' di awal tidak dianggap putus agar handshake awal tidak terinterupsi.
      const hasDisconnected = channels.some(
        (ch) => ch && (ch.state === 'closed' || ch.state === 'errored' || (ch.joinedOnce && ch.state !== 'joined'))
      );
      if (!hasDisconnected) {
        // Channel masih 'joined' — event Realtime tetap masuk, tidak perlu re-fetch full tabel
        return;
      }

      console.log('[App] Disconnected realtime channel detected on visibility change, reconnecting channels & refreshing data...');
      // Re-subscribe channel yang mati agar event realtime berikutnya tetap diterima
      setupSubscriptions();

      useSettingsStore.getState().loadFromCloud();
      useMenuStore.getState().loadFromCloud(true);
      useInventoryStore.getState().loadFromCloud(true);
      useCustomerStore.getState().loadFromCloud(true);
      usePromoStore.getState().loadFromCloud(true);
      useShiftStore.getState().loadFromCloud();
      useCashMovementStore.getState().loadFromCloud(true);
      useStockOpnameStore.getState().loadFromCloud();
    };

    const handleOnline = () => {
      console.log('[App] Online restored, checking connection state...');
      handleVisibilityChange();
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      cleanupSubscriptions();
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [currentUser?.id]);

  return (
    <>
    <ToastContainer />
    <ErrorBoundary>
      <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="text-brand-600 text-lg font-medium">Memuat...</div></div>}>
      <Routes>
        <Route
          path="/"
          element={
            currentUser ? (
              <Navigate
                to={
                  currentUser.role === 'Manager'
                    ? '/dashboard'
                    : currentUser.role === 'Kasir'
                    ? '/pos'
                    : currentUser.role === 'Staf Gudang'
                    ? '/inventory'
                    : '/kitchen'
                }
                replace
              />
            ) : (
              <Login />
            )
          }
        />

        <Route
          element={
            <ProtectedRoute>
              <ShiftGuard>
                <Layout />
              </ShiftGuard>
            </ProtectedRoute>
          }
        >
          <Route path="/pos" element={<ProtectedRoute allowedRoles={['Manager', 'Kasir']}><POS /></ProtectedRoute>} />
          <Route path="/kitchen" element={<ProtectedRoute allowedRoles={['Manager', 'Acaraki']}><Kitchen /></ProtectedRoute>} />
          <Route path="/transactions" element={<ProtectedRoute allowedRoles={['Manager', 'Kasir']}><Transactions /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['Manager']}><Dashboard /></ProtectedRoute>} />
          <Route path="/catalog" element={<ProtectedRoute allowedRoles={['Manager']}><Catalog /></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute allowedRoles={['Manager', 'Staf Gudang']}><Inventory /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute allowedRoles={['Manager']}><Reports /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute allowedRoles={['Manager', 'Kasir']}><Customers /></ProtectedRoute>} />
          <Route path="/promos" element={<ProtectedRoute allowedRoles={['Manager']}><Promos /></ProtectedRoute>} />
          <Route path="/cash-movements" element={<ProtectedRoute allowedRoles={['Manager', 'Kasir']}><CashMovements /></ProtectedRoute>} />
          <Route path="/audit-log" element={<ProtectedRoute allowedRoles={['Manager']}><AuditLog /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute allowedRoles={['Manager', 'Kasir']}><SettingsPage /></ProtectedRoute>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </ErrorBoundary>
    </>
  );
}
