import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { useShiftStore } from '../store/shiftStore';
import { useTransactionStore } from '../store/transactionStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { useCashMovementStore } from '../store/cashMovementStore';
import { useCloudStatus } from '../hooks/useCloudStatus';
import { formatRupiah, formatDate } from '../utils/format';
import { printTextRaw } from '../utils/printer';
import { useState, useMemo, useEffect } from 'react';
import { getQueueLength, setQueueChangeListener } from '../lib/offlineQueue';
import Modal from './Modal';
import PrinterStatusBanner from './PrinterStatusBanner';
import {
  LayoutDashboard,
  ShoppingCart,
  ChefHat,
  ClipboardList,
  Package,
  Users,
  Settings,
  LogOut,
  Menu as MenuIcon,
  FileBarChart,
  Warehouse,
  PanelLeftClose,
  PanelLeftOpen,
  Wallet,
  Gift,
  Shield,
  Sun,
  Moon,
  ClipboardCheck,
  Printer,
} from 'lucide-react';

const navItems = {
  Manager: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/pos', icon: ShoppingCart, label: 'POS' },
    { to: '/kitchen', icon: ChefHat, label: 'Dapur' },
    { to: '/transactions', icon: ClipboardList, label: 'Transaksi' },
    { to: '/catalog', icon: Package, label: 'Katalog' },
    { to: '/inventory', icon: Warehouse, label: 'Inventaris' },
    { to: '/promos', icon: Gift, label: 'Promo' },
    { to: '/reports', icon: FileBarChart, label: 'Laporan' },
    { to: '/customers', icon: Users, label: 'Pelanggan' },
    { to: '/cash-movements', icon: Wallet, label: 'Rekap Kas' },
    { to: '/audit-log', icon: Shield, label: 'Audit Log' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ],
  Kasir: [
    { to: '/pos', icon: ShoppingCart, label: 'POS' },
    { to: '/transactions', icon: ClipboardList, label: 'Transaksi' },
    { to: '/customers', icon: Users, label: 'Pelanggan' },
    { to: '/cash-movements', icon: Wallet, label: 'Rekap Kas' },
    { to: '/settings', icon: Printer, label: 'Printer' },
  ],
  Acaraki: [{ to: '/kitchen', icon: ChefHat, label: 'Dapur' }],
  'Staf Gudang': [
    { to: '/inventory', icon: Warehouse, label: 'Inventaris' },
  ],
};

export default function Layout() {
  const { currentUser, logout } = useAuthStore();
  const { settings } = useSettingsStore();
  const { activeShift, closeShift } = useShiftStore();
  const { transactions, clearKdsDoneOrders } = useTransactionStore();
  const { addLog } = useAuditLogStore();
  const cloudStatus = useCloudStatus();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [queueLength, setQueueLength] = useState(getQueueLength());

  useEffect(() => {
    setQueueChangeListener((count) => {
      setQueueLength(count);
    });
    return () => setQueueChangeListener(() => {});
  }, []);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  // Close shift modal
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [closingCashInput, setClosingCashInput] = useState('');
  // Acaraki summary modal
  const [showAcarakiSummary, setShowAcarakiSummary] = useState(false);

  if (!currentUser) return null;

  const items = navItems[currentUser.role] || [];

  // Today's transactions for this cashier (for shift summary print)
  const todayTx = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return transactions.filter(
      (t) =>
        t.cashierId === currentUser.id &&
        t.txStatus === 'Selesai' &&
        new Date(t.date) >= today
    );
  }, [transactions, currentUser]);

  // Calculate shift stats
  const movements = useCashMovementStore((s) => s.movements);
  const shiftStats = useMemo(() => {
    if (!activeShift) return { totalSales: 0, totalTx: 0, expectedCash: 0, cashIn: 0, cashOut: 0, cashSales: 0, qrisSales: 0, transferSales: 0 };
    // LOGIC-4 fix: Only count Selesai transactions for sales and expected cash
    const shiftTx = transactions.filter(
      (t) =>
        t.cashierId === currentUser.id &&
        t.txStatus === 'Selesai' &&
        new Date(t.date) >= new Date(activeShift.openedAt)
    );
    const totalSales = shiftTx.reduce((a, t) => a + t.totalAmount, 0);

    const cashSales = shiftTx
      .filter((t) => t.paymentMethod === 'Cash')
      .reduce((a, t) => a + t.totalAmount, 0);
    const qrisSales = shiftTx
      .filter((t) => t.paymentMethod === 'QRIS')
      .reduce((a, t) => a + t.totalAmount, 0);
    const transferSales = shiftTx
      .filter((t) => t.paymentMethod === 'Transfer')
      .reduce((a, t) => a + t.totalAmount, 0);

    // Calculate cash movements (Kas Masuk & Kas Keluar) during active shift
    const shiftMovements = movements.filter(
      (m) =>
        m.cashierId === currentUser.id &&
        new Date(m.date) >= new Date(activeShift.openedAt)
    );
    const cashIn = shiftMovements
      .filter((m) => m.type === 'in')
      .reduce((a, m) => a + m.amount, 0);
    const cashOut = shiftMovements
      .filter((m) => m.type === 'out')
      .reduce((a, m) => a + m.amount, 0);

    const expectedCash = activeShift.openingCash + cashSales + cashIn - cashOut;
    return { totalSales, totalTx: shiftTx.length, expectedCash, cashSales, qrisSales, transferSales, cashIn, cashOut };
  }, [activeShift, transactions, movements, currentUser]);

  const handleLogout = () => {
    if (activeShift && (currentUser.role === 'Kasir' || currentUser.role === 'Manager')) {
      setShowCloseShift(true);
      setClosingCashInput('');
    } else if (currentUser.role === 'Acaraki') {
      setShowAcarakiSummary(true);
    } else {
      logout();
      navigate('/');
    }
  };

  // Acaraki done orders for summary
  const acarakiDoneOrders = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return transactions.filter(
      (t) => t.kitchenStatus === 'Done' && t.txStatus === 'Selesai' && new Date(t.date) >= today
    );
  }, [transactions]);

  const handleAcarakiPrint = async () => {
    const lines = [
      '=== RINGKASAN DAPUR ===',
      `Tanggal: ${new Date().toLocaleDateString('id-ID')}`,
      `Acaraki: ${currentUser.name}`,
      `Total Pesanan Selesai: ${acarakiDoneOrders.length}`,
      '',
      '--- Detail ---',
      ...acarakiDoneOrders.map(
        (o) => `#${o.queueNumber} - ${o.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}`
      ),
      '',
      '========================',
    ];
    await printTextRaw(lines, settings);
    // Reset done orders on KDS
    clearKdsDoneOrders();
    setShowAcarakiSummary(false);
    logout();
    navigate('/');
  };

  const handleAcarakiSkip = () => {
    clearKdsDoneOrders();
    setShowAcarakiSummary(false);
    logout();
    navigate('/');
  };

  const handleCloseShift = async () => {
    const closingCash = parseInt(closingCashInput) || 0;
    closeShift(closingCash, shiftStats.totalSales, shiftStats.totalTx, shiftStats.expectedCash);

    // Audit log
    if (currentUser) {
      addLog(currentUser.id, currentUser.name, currentUser.role, 'close_shift', `Tutup shift - Kas aktual: ${formatRupiah(closingCash)}, Expected: ${formatRupiah(shiftStats.expectedCash)}`, { closingCash, expectedCash: shiftStats.expectedCash, totalSales: shiftStats.totalSales, totalTx: shiftStats.totalTx });
    }

    // ITEM-4 fix: Explicit breakdown & explanation of Expected Cash vs Kas Aktual
    const lines = [
      `=== RINGKASAN TRANSAKSI ===`,
      `${settings.storeName}`,
      `Tanggal: ${new Date().toLocaleDateString('id-ID')}`,
      `Kasir: ${currentUser.name}`,
      ``,
      `Modal Awal: ${formatRupiah(activeShift?.openingCash || 0)}`,
      `Total Penjualan: ${formatRupiah(shiftStats.totalSales)}`,
      `  - Tunai (Cash): ${formatRupiah(shiftStats.cashSales || 0)}`,
      `  - QRIS: ${formatRupiah(shiftStats.qrisSales || 0)}`,
      `  - Transfer: ${formatRupiah(shiftStats.transferSales || 0)}`,
      `Jumlah Transaksi: ${shiftStats.totalTx}`,
      `Kas Masuk: +${formatRupiah(shiftStats.cashIn || 0)}`,
      `Kas Keluar: -${formatRupiah(shiftStats.cashOut || 0)}`,
      ``,
      `Expected Cash: ${formatRupiah(shiftStats.expectedCash)}`,
      `(Modal Awal + Tunai + Kas Masuk - Kas Keluar)`,
      `Kas Aktual (Fisik): ${formatRupiah(closingCash)}`,
      `Selisih Kas: ${formatRupiah(closingCash - shiftStats.expectedCash)}`,
      ``,
      `--- Riwayat Transaksi ---`,
      ...todayTx.map(
        (t) => `#${t.queueNumber} | ${t.paymentMethod} | ${formatRupiah(t.totalAmount)}`
      ),
      ``,
      `===========================`,
    ];
    await printTextRaw(lines, settings);

    setShowCloseShift(false);
    logout();
    navigate('/');
  };

  return (
    <div className="flex h-full">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 bg-white dark:bg-slate-800 border-r border-slate-100 dark:border-slate-700/50 flex flex-col transition-all duration-200 ${
          sidebarCollapsed ? 'w-[68px]' : 'w-64'
        } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className={`p-4 border-b border-slate-100 dark:border-slate-700/50 flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
          {settings.storeLogo ? (
            <img src={settings.storeLogo} alt="Logo" className="w-8 h-8 rounded-lg object-contain flex-shrink-0" />
          ) : (
            <span className="text-xl flex-shrink-0">🏪</span>
          )}
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <h1 className="text-base font-bold text-brand-700 dark:text-brand-400 truncate">{settings.storeName}</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">POS System</p>
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              title={sidebarCollapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                  sidebarCollapsed ? 'justify-center' : ''
                } ${
                  isActive
                    ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`
              }
            >
              <item.icon size={18} className="flex-shrink-0" />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Shift indicator */}
        {activeShift && !sidebarCollapsed && (
          <div className="mx-3 mb-2 p-2.5 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/50 rounded-xl">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <Wallet size={14} />
              <span className="text-xs font-medium">Shift Aktif</span>
            </div>
            <p className="text-xs text-green-600 dark:text-green-500 mt-1">
              Modal: {formatRupiah(activeShift.openingCash)}
            </p>
          </div>
        )}

        {/* Cloud sync status */}
        {!sidebarCollapsed && cloudStatus !== 'disabled' && (
          <div className={`mx-3 mb-2 px-3 py-1.5 rounded-lg flex items-center justify-between text-xs ${
            cloudStatus === 'connected' ? 'bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400' :
            cloudStatus === 'disconnected' ? 'bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400' :
            'bg-slate-50 dark:bg-slate-900 text-slate-400 dark:text-slate-500'
          }`}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                cloudStatus === 'connected' ? 'bg-blue-500' :
                cloudStatus === 'disconnected' ? 'bg-red-500' :
                'bg-slate-300 animate-pulse'
              }`} />
              <span>{cloudStatus === 'connected' ? 'Cloud Sync' : cloudStatus === 'disconnected' ? 'Offline' : 'Connecting...'}</span>
            </div>
            {queueLength > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500 text-white rounded-full animate-pulse" title={`${queueLength} operasi sync tertunda`}>
                {queueLength}
              </span>
            )}
          </div>
        )}

        {/* Collapse & Theme toggles */}
        <div className={`hidden lg:flex items-center border-t border-slate-100 dark:border-slate-700/50 p-2 ${sidebarCollapsed ? 'flex-col gap-2' : 'justify-between px-4'}`}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition"
            title={sidebarCollapsed ? 'Perluas sidebar' : 'Sembunyikan sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition"
            title={theme === 'light' ? 'Mode Gelap' : 'Mode Terang'}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </div>

        {/* User info */}
        <div className={`p-3 border-t border-slate-100 dark:border-slate-700/50 ${sidebarCollapsed ? 'flex flex-col items-center' : ''}`}>
          {!sidebarCollapsed && (
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-brand-200 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 flex items-center justify-center font-bold text-sm flex-shrink-0">
                {currentUser.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium dark:text-slate-200 truncate">{currentUser.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{currentUser.role}</p>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            title={sidebarCollapsed ? 'Tutup Shift & Keluar' : undefined}
            className={`btn-ghost text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 ${sidebarCollapsed ? 'p-2' : 'w-full'}`}
          >
            <LogOut size={16} />
            {!sidebarCollapsed && <span>{activeShift ? 'Tutup Shift' : 'Keluar'}</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 h-full">
        {/* Printer Status Banner — monitors Bluetooth connections */}
        <PrinterStatusBanner />

        {/* Mobile header (Centered Logo & Store Name) */}
        <header className="lg:hidden relative flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700/50 min-h-[56px]">
          <button onClick={() => setSidebarOpen(true)} className="btn-ghost p-2 z-10">
            <MenuIcon size={20} />
          </button>

          {/* Centered Store Logo & Title */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-12">
            <div className="flex items-center gap-2 max-w-[220px] sm:max-w-none">
              {settings.storeLogo ? (
                <img src={settings.storeLogo} alt="Logo" className="w-7 h-7 rounded-lg object-contain flex-shrink-0" />
              ) : (
                <span className="text-lg flex-shrink-0">🌿</span>
              )}
              <h1 className="text-base sm:text-lg font-bold text-brand-700 dark:text-brand-400 truncate text-center">
                {settings.storeName}
              </h1>
            </div>
          </div>

          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition z-10"
            title={theme === 'light' ? 'Mode Gelap' : 'Mode Terang'}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </div>
      </main>

      {/* Close Shift Modal — Kasir WAJIB isi kas */}
      <Modal
        open={showCloseShift}
        onClose={() => {}} // Cannot dismiss
        title="Tutup Shift & Serah Terima Kas"
        maxWidth="max-w-md"
        dismissible={false}
      >
        <div className="space-y-5">
          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 rounded-xl p-4">
            <h3 className="font-semibold text-sm text-blue-900 dark:text-blue-200 mb-2.5 flex items-center justify-between">
              <span>Ringkasan Shift</span>
              <span className="text-xs font-normal text-blue-600 dark:text-blue-300">Shift Active</span>
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-blue-700 dark:text-blue-300">Modal Awal</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">{formatRupiah(activeShift?.openingCash || 0)}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-blue-700 dark:text-blue-300">Total Penjualan</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">{formatRupiah(shiftStats.totalSales)}</span>
              </div>

              <div className="pl-3 space-y-1 text-xs text-slate-600 dark:text-slate-400 border-l-2 border-blue-200 dark:border-blue-800">
                <div className="flex justify-between">
                  <span>• Penjualan Tunai (Cash)</span>
                  <span>{formatRupiah(shiftStats.cashSales || 0)}</span>
                </div>
                {shiftStats.qrisSales > 0 && (
                  <div className="flex justify-between">
                    <span>• Penjualan QRIS</span>
                    <span>{formatRupiah(shiftStats.qrisSales)}</span>
                  </div>
                )}
                {shiftStats.transferSales > 0 && (
                  <div className="flex justify-between">
                    <span>• Penjualan Transfer</span>
                    <span>{formatRupiah(shiftStats.transferSales)}</span>
                  </div>
                )}
              </div>

              {/* Kas Masuk */}
              <div className="flex justify-between items-center bg-green-50 dark:bg-green-950/30 px-2.5 py-1.5 rounded-lg border border-green-200/50 dark:border-green-900/30">
                <span className="text-green-700 dark:text-green-300 font-medium text-xs">
                  📥 Kas Masuk (Shift Ini)
                </span>
                <span className="font-bold text-green-700 dark:text-green-300">
                  +{formatRupiah(shiftStats.cashIn || 0)}
                </span>
              </div>

              {/* Kas Keluar */}
              <div className="flex justify-between items-center bg-red-50 dark:bg-red-950/30 px-2.5 py-1.5 rounded-lg border border-red-200/50 dark:border-red-900/30">
                <span className="text-red-700 dark:text-red-300 font-medium text-xs">
                  📤 Kas Keluar (Shift Ini)
                </span>
                <span className="font-bold text-red-700 dark:text-red-300">
                  -{formatRupiah(shiftStats.cashOut || 0)}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-blue-700 dark:text-blue-300">Jumlah Transaksi</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">{shiftStats.totalTx}</span>
              </div>

              <div className="flex justify-between items-start border-t border-blue-200 dark:border-blue-800 pt-2.5 mt-2">
                <div>
                  <span className="text-blue-900 dark:text-blue-200 font-bold block">Expected Cash di Laci</span>
                  <span className="text-[10px] text-blue-600 dark:text-blue-400 block font-normal">(Modal Awal + Tunai + Kas Masuk - Kas Keluar)</span>
                </div>
                <span className="font-bold text-blue-900 dark:text-blue-200 text-base">{formatRupiah(shiftStats.expectedCash)}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="label">Jumlah Kas Aktual di Laci (Rp) *</label>
            <input
              type="text"
              value={closingCashInput}
              onChange={(e) => setClosingCashInput(e.target.value.replace(/\D/g, ''))}
              placeholder="WAJIB diisi — hitung uang di laci"
              className="input text-lg font-semibold"
              autoFocus
            />
            {closingCashInput && (
              <div className={`mt-2 p-2 rounded-lg text-sm font-medium ${
                parseInt(closingCashInput) === shiftStats.expectedCash
                  ? 'bg-green-50 text-green-700'
                  : parseInt(closingCashInput) > shiftStats.expectedCash
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-red-50 text-red-700'
              }`}>
                Selisih: {formatRupiah((parseInt(closingCashInput) || 0) - shiftStats.expectedCash)}
                {parseInt(closingCashInput) === shiftStats.expectedCash && ' ✓ Pas'}
              </div>
            )}
            {!closingCashInput && (
              <p className="text-xs text-red-500 mt-1">* Wajib diisi untuk menutup shift</p>
            )}
          </div>

          <button
            onClick={() => {
              const closingCash = parseInt(closingCashInput) || 0;
              const diff = Math.abs(closingCash - shiftStats.expectedCash);
              const threshold = shiftStats.expectedCash * 0.1; // 10%
              // BUG-08: Confirm if difference > 10% of expected
              if (diff > threshold && shiftStats.expectedCash > 0) {
                if (!window.confirm(
                  `⚠️ Selisih kas ${formatRupiah(diff)} (${diff > 0 ? 'lebih' : 'kurang'}).\n\nApakah Anda yakin jumlah kas sudah benar?`
                )) return;
              }
              handleCloseShift();
            }}
            className="btn-primary w-full"
            disabled={!closingCashInput}
          >
            Print Ringkasan & Tutup Shift
          </button>
        </div>
      </Modal>

      {/* Acaraki Summary Modal */}
      <Modal
        open={showAcarakiSummary}
        onClose={() => {}}
        title="Ringkasan Pesanan Selesai"
        maxWidth="max-w-md"
        dismissible={false}
      >
        <div className="space-y-4">
          <div className="bg-green-50 rounded-xl p-4 text-center">
            <p className="text-sm text-green-700">Total Pesanan Selesai Hari Ini</p>
            <p className="text-3xl font-bold text-green-800">{acarakiDoneOrders.length}</p>
          </div>

          {acarakiDoneOrders.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-2">
              {acarakiDoneOrders.map((o) => (
                <div key={o.id} className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg text-sm">
                  <span className="font-bold text-brand-700">#{o.queueNumber}</span>
                  <span className="flex-1 truncate text-slate-600">
                    {o.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 pt-3 border-t border-slate-100">
            <button onClick={handleAcarakiSkip} className="btn-secondary flex-1 text-sm">
              Lewati
            </button>
            <button onClick={handleAcarakiPrint} className="btn-primary flex-1">
              Print & Keluar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
