import { useMemo, useState } from 'react';
import { useTransactionStore } from '../store/transactionStore';
import { useInventoryStore } from '../store/inventoryStore';
import { useMenuStore } from '../store/menuStore';
import { useCustomerStore } from '../store/customerStore';
import { useStockLogStore } from '../store/stockLogStore';
import { formatRupiah, isSameDay } from '../utils/format';
import { calculateMenuHPP } from '../utils/hpp';
import { splitContributionDivisor } from '../utils/splitAllocation';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import {
  TrendingUp,
  ShoppingCart,
  Award,
  AlertTriangle,
  DollarSign,
  Package,
  Clock,
  Users,
  LineChart,
  Grid,
} from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

type Period = 'daily' | 'weekly' | 'monthly' | 'yearly';
type ActiveTab = 'overview' | 'analytics';

export default function Dashboard() {
  const { transactions } = useTransactionStore();
  const { items: inventory } = useInventoryStore();
  const { menus } = useMenuStore();
  const { customers } = useCustomerStore();
  const { logs: stockLogs } = useStockLogStore();

  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [period, setPeriod] = useState<Period>('daily');
  const [trendPeriod, setTrendPeriod] = useState<'7days' | '30days'>('7days');

  const today = new Date();
  const todayTx = transactions.filter(
    (t) => isSameDay(new Date(t.date), today) && t.txStatus === 'Selesai' && !t.splitParentId && !t.refunded
  );

  const todayGrossRevenue = todayTx.reduce((a, t) => a + t.subtotal, 0);
  const todayDiscount = todayTx.reduce((a, t) => a + t.discount, 0);
  const todayNetRevenue = todayGrossRevenue - todayDiscount;
  const todayRevenue = todayTx.reduce((a, t) => a + t.totalAmount, 0); // Omset fisik (termasuk pajak) untuk display omset
  const todayHPP = todayTx.reduce((a, t) => a + t.hpp, 0);
  const todayProfit = todayNetRevenue - todayHPP; // Laba kotor murni (bersih dari diskon & pajak)
  const todayCount = todayTx.length;

  // Best seller
  // v4.5 TO DO 5.11: sub-bill split equal membawa semua item di setiap bagian → qty per menu
  // ter-inflasi N×. Bagi kontribusinya dengan totalSplitCount (deteksi via isEqualSplitSubBill).
  const menuSales = useMemo(() => {
    const map: Record<string, { name: string; qty: number }> = {};
    todayTx.forEach((t) => {
      const div = splitContributionDivisor(t);
      t.items.forEach((i) => {
        if (!map[i.menuId]) map[i.menuId] = { name: i.name, qty: 0 };
        map[i.menuId].qty += i.quantity / div;
      });
    });
    return Object.values(map).sort((a, b) => b.qty - a.qty);
  }, [todayTx]);

  const bestSeller = menuSales[0]?.name || '-';

  // Low stock
  const lowStock = inventory.filter((i) => i.stock < (i.minStock ?? 3));

  // Payment distribution
  const paymentDist = useMemo(() => {
    const map = { Cash: 0, QRIS: 0, Transfer: 0 };
    todayTx.forEach((t) => {
      if (t.paymentMethod in map) {
        map[t.paymentMethod]++;
      }
    });
    return map;
  }, [todayTx]);

  // Revenue chart data (Overview)
  const chartData = useMemo(() => {
    const labels: string[] = [];
    const data: number[] = [];

    if (period === 'daily') {
      for (let h = 8; h <= 22; h++) {
        labels.push(`${h}:00`);
        const rev = transactions
          .filter((t) => {
            const d = new Date(t.date);
            return isSameDay(d, today) && d.getHours() === h && t.txStatus === 'Selesai' && !t.splitParentId && !t.refunded;
          })
          .reduce((a, t) => a + t.totalAmount, 0);
        data.push(rev);
      }
    } else if (period === 'weekly') {
      const days = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        labels.push(days[d.getDay() === 0 ? 6 : d.getDay() - 1]);
        const rev = transactions
          .filter((t) => isSameDay(new Date(t.date), d) && t.txStatus === 'Selesai' && !t.splitParentId && !t.refunded)
          .reduce((a, t) => a + t.totalAmount, 0);
        data.push(rev);
      }
    } else if (period === 'monthly') {
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        labels.push(`${d.getDate()}`);
        const rev = transactions
          .filter((t) => isSameDay(new Date(t.date), d) && t.txStatus === 'Selesai' && !t.splitParentId && !t.refunded)
          .reduce((a, t) => a + t.totalAmount, 0);
        data.push(rev);
      }
    } else {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      for (let m = 0; m < 12; m++) {
        labels.push(months[m]);
        const rev = transactions
          .filter((t) => {
            const d = new Date(t.date);
            return d.getFullYear() === today.getFullYear() && d.getMonth() === m && t.txStatus === 'Selesai' && !t.splitParentId && !t.refunded;
          })
          .reduce((a, t) => a + t.totalAmount, 0);
        data.push(rev);
      }
    }

    return {
      labels,
      datasets: [
        {
          label: 'Omset',
          data,
          backgroundColor: 'rgba(184, 95, 33, 0.7)',
          borderRadius: 8,
        },
      ],
    };
  }, [transactions, period]);

  // ==========================================
  // ADVANCED ANALYTICS MODULES CALCULATION
  // ==========================================

  // Modul 1: Sales & Profit Trend (Line Chart)
  const trendChartData = useMemo(() => {
    const limitDays = trendPeriod === '7days' ? 7 : 30;
    const labels: string[] = [];
    const revenueData: number[] = [];
    const profitData: number[] = [];

    for (let i = limitDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      labels.push(d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }));

      const dailyTxs = transactions.filter(
        (t) => isSameDay(new Date(t.date), d) && t.txStatus === 'Selesai' && !t.splitParentId && !t.refunded
      );
      const grossRev = dailyTxs.reduce((a, t) => a + t.subtotal, 0);
      const disc = dailyTxs.reduce((a, t) => a + t.discount, 0);
      const netRev = grossRev - disc;
      const hpp = dailyTxs.reduce((a, t) => a + t.hpp, 0);

      revenueData.push(dailyTxs.reduce((a, t) => a + t.totalAmount, 0));
      profitData.push(netRev - hpp);
    }

    return {
      labels,
      datasets: [
        {
          label: 'Revenue',
          data: revenueData,
          borderColor: '#b85f21',
          backgroundColor: 'rgba(184, 95, 33, 0.1)',
          fill: true,
          tension: 0.3,
        },
        {
          label: 'Laba Kotor',
          data: profitData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.3,
        },
      ],
    };
  }, [transactions, trendPeriod]);

  // Modul 2: Busy Hours Grid Heatmap (CSS grid calculation)
  // 7 days (0: Mon, 6: Sun) x 15 hours (8:00 - 22:00)
  const busyHoursData = useMemo(() => {
    const matrix = Array(7)
      .fill(0)
      .map(() => Array(15).fill(0));
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const relevantTxs = transactions.filter((t) => {
      const d = new Date(t.date);
      return d >= thirtyDaysAgo && t.txStatus === 'Selesai' && !t.splitParentId && !t.refunded;
    });

    relevantTxs.forEach((t) => {
      const d = new Date(t.date);
      let dayIndex = d.getDay(); // 0 is Sunday, 1 is Monday...
      // Shift so Mon is 0, Sun is 6
      dayIndex = dayIndex === 0 ? 6 : dayIndex - 1;
      
      const hour = d.getHours();
      if (hour >= 8 && hour <= 22) {
        matrix[dayIndex][hour - 8]++;
      }
    });

    // Find max value for scaling the opacity color
    let maxCount = 1;
    matrix.forEach((row) => {
      row.forEach((val) => {
        if (val > maxCount) maxCount = val;
      });
    });

    return { matrix, maxCount };
  }, [transactions]);

  // Modul 3: Customer Retention Metrics
  const customerRetention = useMemo(() => {
    const total = customers.length;
    const returning = customers.filter((c) => c.visitCount > 1).length;
    const newCustomers = total - returning;
    const retentionRate = total > 0 ? Math.round((returning / total) * 100) : 0;

    const topLoyal = [...customers]
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, 5);

    return { total, returning, newCustomers, retentionRate, topLoyal };
  }, [customers]);

  // Modul 4: Menu Profitability Table
  const menuProfitability = useMemo(() => {
    const map: Record<string, { name: string; qty: number; revenue: number; hpp: number }> = {};
    
    // Group only last 30 days for fresh profitability insight
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const filterTxs = transactions.filter(
      (t) => new Date(t.date) >= thirtyDaysAgo && t.txStatus === 'Selesai' && !t.splitParentId && !t.refunded
    );

    filterTxs.forEach((t) => {
      // v4.5 TO DO 5.11: sub-bill split equal membawa semua item cart di tiap bagian dengan
      // subtotal/hpp penuh → qty/revenue/hpp per menu ter-inflasi N×. Bagi dengan totalSplitCount.
      const div = splitContributionDivisor(t);
      t.items.forEach((item) => {
        if (!map[item.menuId]) {
          map[item.menuId] = { name: item.name, qty: 0, revenue: 0, hpp: 0 };
        }
        
        // Priority: Read permanent Snapshot HPP (item.hpp / item.cogs).
        // Fallback for legacy transactions created before snapshot feature.
        const menuObj = menus.find((m) => m.id === item.menuId);
        let itemHpp = item.cogs ?? item.hpp;
        if (itemHpp === undefined) {
          const menuHpp = menuObj ? calculateMenuHPP(menuObj, inventory) : 0;
          const baseHpp = menuObj && menuObj.price > 0 ? (item.basePrice / menuObj.price) * menuHpp : 0;
          itemHpp = baseHpp * item.quantity;
        }

        map[item.menuId].qty += item.quantity / div;
        map[item.menuId].revenue += item.subtotal / div;
        map[item.menuId].hpp += itemHpp / div;
      });
    });

    return Object.values(map)
      .map((m) => {
        const profit = m.revenue - m.hpp;
        const margin = m.revenue > 0 ? Math.round((profit / m.revenue) * 100) : 0;
        return { ...m, profit, margin };
      })
      .sort((a, b) => b.profit - a.profit);
  }, [transactions, menus, inventory]);

  // Modul 5: Stock Forecast (days until depletion based on 30-day average)
  const stockForecast = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    // Calculate usage from stock logs
    const usageMap: Record<string, number> = {};
    const deductLogs = stockLogs.filter(
      (l) => new Date(l.date) >= thirtyDaysAgo && l.type === 'deduct'
    );

    deductLogs.forEach((l) => {
      // amount is stored as negative in stockLogStore
      const qtyUsed = Math.abs(l.amount);
      usageMap[l.inventoryId] = (usageMap[l.inventoryId] || 0) + qtyUsed;
    });

    return inventory.map((item) => {
      const totalUsed30Days = usageMap[item.id] || 0;
      const dailyUsage = totalUsed30Days / 30;
      
      let daysRemaining = Infinity;
      if (dailyUsage > 0) {
        daysRemaining = Math.max(0, item.stock / dailyUsage);
      }

      return {
        ...item,
        dailyUsage,
        daysRemaining,
      };
    }).sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [inventory, stockLogs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-center sm:text-left w-full sm:w-auto">📊 Dashboard & Analitik</h1>
        
        {/* Navigation Tabs */}
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 w-full sm:w-auto justify-center">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'overview'
                ? 'bg-white dark:bg-slate-700 text-brand-700 dark:text-brand-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Ringkasan
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'analytics'
                ? 'bg-white dark:bg-slate-700 text-brand-700 dark:text-brand-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Analytics Lanjutan
          </button>
        </div>
      </div>

      {activeTab === 'overview' ? (
        // ==========================================
        // OVERVIEW TAB (Existing Dashboard layout)
        // ==========================================
        <div className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card p-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-green-100 dark:bg-green-950/40 flex items-center justify-center">
                  <TrendingUp className="text-green-600 dark:text-green-400" size={22} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Pendapatan Hari Ini</p>
                  <p className="text-xl font-bold text-green-700 dark:text-green-400">{formatRupiah(todayRevenue)}</p>
                </div>
              </div>
            </div>
            <div className="card p-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
                  <ShoppingCart className="text-blue-600 dark:text-blue-400" size={22} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Jumlah Transaksi</p>
                  <p className="text-xl font-bold text-slate-800 dark:text-slate-200">{todayCount}</p>
                </div>
              </div>
            </div>
            <div className="card p-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center">
                  <Award className="text-amber-600 dark:text-amber-400" size={22} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Menu Terlaris</p>
                  <p className="text-lg font-bold text-slate-800 dark:text-slate-200 truncate max-w-[140px]">{bestSeller}</p>
                </div>
              </div>
            </div>
            <div className="card p-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-purple-100 dark:bg-purple-950/40 flex items-center justify-center">
                  <DollarSign className="text-purple-600 dark:text-purple-400" size={22} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Laba Kotor Hari Ini</p>
                  <p className="text-xl font-bold text-purple-700 dark:text-purple-400">{formatRupiah(todayProfit)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">Grafik Omset</h2>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as Period)}
                className="input w-auto text-sm"
              >
                <option value="daily">Harian</option>
                <option value="weekly">Mingguan</option>
                <option value="monthly">Bulanan</option>
                <option value="yearly">Tahunan</option>
              </select>
            </div>
            <div className="h-64">
              <Bar
                data={chartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: { beginAtZero: true, ticks: { callback: (v) => formatRupiah(v as number) } },
                  },
                }}
              />
            </div>
          </div>

          {/* Bottom Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Payment Distribution */}
            <div className="card p-5">
              <h3 className="font-bold mb-3">Metode Pembayaran</h3>
              <div className="h-48">
                <Doughnut
                  data={{
                    labels: ['Cash', 'QRIS', 'Transfer'],
                    datasets: [
                      {
                        data: [paymentDist.Cash, paymentDist.QRIS, paymentDist.Transfer],
                        backgroundColor: ['#22c55e', '#8b5cf6', '#3b82f6'],
                      },
                    ],
                  }}
                  options={{ responsive: true, maintainAspectRatio: false }}
                />
              </div>
            </div>

            {/* Best Sellers */}
            <div className="card p-5 flex flex-col">
              <h3 className="font-bold mb-3">🏆 Top Menu</h3>
              <div className="space-y-2 overflow-y-auto max-h-48">
                {menuSales.slice(0, 10).map((m, i) => (
                  <div key={m.name} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-sm truncate text-slate-700 dark:text-slate-200">{m.name}</span>
                    <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                      {Number.isInteger(m.qty) ? m.qty : m.qty.toFixed(1)}x
                    </span>
                  </div>
                ))}
                {menuSales.length === 0 && (
                  <p className="text-sm text-slate-400">Belum ada data</p>
                )}
              </div>
            </div>

            {/* Low Stock Alert */}
            <div className="card p-5 flex flex-col">
              <h3 className="font-bold mb-3 flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500" /> Stok Rendah
                {lowStock.length > 0 && <span className="badge bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50 text-xs">{lowStock.length}</span>}
              </h3>
              <div className="space-y-2 overflow-y-auto max-h-48">
                {lowStock.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-950/20 border border-red-100/50 dark:border-red-900/30 rounded-lg">
                    <span className="text-sm font-medium text-red-900 dark:text-red-300">{item.name}</span>
                    <span className="badge bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50">
                      {item.stock} {item.unit}
                    </span>
                  </div>
                ))}
                {lowStock.length === 0 && (
                  <p className="text-sm text-green-600 dark:text-green-400">✓ Semua stok aman</p>
                )}
              </div>
            </div>
          </div>

          {/* P&L Summary */}
          <div className="card p-5">
            <h3 className="font-bold mb-3 flex items-center gap-2">
              <Package size={18} /> Laporan Keuangan Hari Ini (P&L Sederhana)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 bg-green-50 dark:bg-green-950/20 border border-green-100/50 dark:border-green-900/10 rounded-xl">
                <p className="text-xs text-slate-500 dark:text-slate-400">Total Pendapatan</p>
                <p className="text-xl font-bold text-green-700 dark:text-green-400">{formatRupiah(todayRevenue)}</p>
              </div>
              <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-100/50 dark:border-red-900/10 rounded-xl">
                <p className="text-xs text-slate-500 dark:text-slate-400">HPP (Cost of Goods)</p>
                <p className="text-xl font-bold text-red-700 dark:text-red-400">{formatRupiah(todayHPP)}</p>
              </div>
              <div className="p-4 bg-purple-50 dark:bg-purple-950/20 border border-purple-100/50 dark:border-purple-900/10 rounded-xl">
                <p className="text-xs text-slate-500 dark:text-slate-400">Laba Kotor</p>
                <p className="text-xl font-bold text-purple-700 dark:text-purple-400">{formatRupiah(todayProfit)}</p>
              </div>
            </div>
            <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/10 rounded-xl">
              <p className="text-xs text-slate-500 dark:text-slate-400">Expected Cash (Transaksi Cash Hari Ini)</p>
              <p className="text-xl font-bold text-blue-700 dark:text-blue-400">
                {formatRupiah(todayTx.filter((t) => t.paymentMethod === 'Cash').reduce((a, t) => a + t.totalAmount, 0))}
              </p>
            </div>
          </div>
        </div>
      ) : (
        // ==========================================
        // ADVANCED ANALYTICS TAB (5 New Modules)
        // ==========================================
        <div className="space-y-6 animate-fade-in-up">
          {/* Row 1: Sales Trend Chart */}
          <div className="card p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <LineChart size={18} className="text-brand-600" />
                  Tren Penjualan & Profitabilitas
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Analisis pendapatan kotor vs modal HPP produk</p>
              </div>
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 self-start">
                <button
                  onClick={() => setTrendPeriod('7days')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    trendPeriod === '7days'
                      ? 'bg-white dark:bg-slate-700 shadow-sm text-brand-700 dark:text-brand-400'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  7 Hari Terakhir
                </button>
                <button
                  onClick={() => setTrendPeriod('30days')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    trendPeriod === '30days'
                      ? 'bg-white dark:bg-slate-700 shadow-sm text-brand-700 dark:text-brand-400'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  30 Hari Terakhir
                </button>
              </div>
            </div>
            <div className="h-72">
              <Line
                data={trendChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { mode: 'index', intersect: false },
                  plugins: { legend: { position: 'top' as const } },
                  scales: {
                    y: { beginAtZero: true, ticks: { callback: (v) => formatRupiah(v as number) } },
                  },
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Row 2 - Left: Busy Hours Heatmap */}
            <div className="card p-5 flex flex-col">
              <div className="mb-4">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Clock size={18} className="text-brand-600" />
                  Heatmap Jam Sibuk (30 Hari Terakhir)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Visualisasi jam sibuk transaksi untuk optimasi shift kerja</p>
              </div>
              <div className="flex-1 overflow-x-auto">
                <div className="min-w-[480px]">
                  {/* Grid Header Hours */}
                  <div className="grid grid-cols-16 gap-1 mb-2 text-center text-[10px] font-semibold text-slate-500">
                    <div>Hari</div>
                    {Array(15)
                      .fill(0)
                      .map((_, i) => (
                        <div key={i}>{i + 8}</div>
                      ))}
                  </div>
                  {/* Grid Rows for Days */}
                  <div className="space-y-1">
                    {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((day, dIdx) => (
                      <div key={day} className="grid grid-cols-16 gap-1 items-center">
                        <div className="text-xs font-bold text-slate-600 dark:text-slate-400 text-left">{day}</div>
                        {Array(15)
                          .fill(0)
                          .map((_, hIdx) => {
                            const count = busyHoursData.matrix[dIdx][hIdx];
                            const intensity = count / busyHoursData.maxCount;
                            
                            // Color mapping based on intensity (White -> Amber -> Deep Orange)
                            let bgColor = 'bg-slate-50 dark:bg-slate-900/40';
                            let textColor = 'text-slate-400 dark:text-slate-600';
                            let style = {};

                            if (count > 0) {
                              textColor = intensity > 0.6 ? 'text-white' : 'text-amber-950 dark:text-amber-300';
                              style = {
                                backgroundColor: `rgba(245, 158, 11, ${Math.max(0.1, intensity)})`,
                                border: `1px solid rgba(245, 158, 11, ${intensity + 0.1})`,
                              };
                            }

                            return (
                              <div
                                key={hIdx}
                                className={`heatmap-cell ${bgColor} ${textColor}`}
                                style={style}
                                title={`${day} jam ${hIdx + 8}:00 - ${count} transaksi`}
                              >
                                {count > 0 ? count : ''}
                              </div>
                            );
                          })}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center justify-end gap-3 text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                    <span>Senggang</span>
                    <div className="flex gap-0.5">
                      <div className="w-3 h-3 rounded bg-amber-500/10 border border-amber-500/20" />
                      <div className="w-3 h-3 rounded bg-amber-500/40 border border-amber-500/50" />
                      <div className="w-3 h-3 rounded bg-amber-500/70 border border-amber-500/80" />
                      <div className="w-3 h-3 rounded bg-amber-500 border border-amber-600" />
                    </div>
                    <span>Sangat Sibuk</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 2 - Right: Customer Retention Statistics */}
            <div className="card p-5 flex flex-col justify-between">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2 mb-1">
                  <Users size={18} className="text-brand-600" />
                  Statistik & Retensi Pelanggan (CRM)
                </h3>
                <p className="text-xs text-slate-500 mb-4">Analisis loyalitas pelanggan terdaftar</p>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-brand-50/50 dark:bg-brand-900/20 rounded-xl p-3.5 text-center border border-brand-100 dark:border-brand-700/40">
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Member</p>
                  <p className="text-2xl font-bold text-brand-700 dark:text-brand-300 mt-1">{customerRetention.total}</p>
                </div>
                <div className="bg-green-50/50 dark:bg-green-900/20 rounded-xl p-3.5 text-center border border-green-100 dark:border-green-700/40">
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Muka Lama</p>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-300 mt-1">{customerRetention.returning}</p>
                </div>
                <div className="bg-blue-50/50 dark:bg-blue-900/20 rounded-xl p-3.5 text-center border border-blue-100 dark:border-blue-700/40">
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Retention</p>
                  <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">{customerRetention.retentionRate}%</p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm text-slate-700 dark:text-slate-300 mb-2">⭐ Pelanggan Paling Loyal (Kunjungan Terbanyak)</h4>
                <div className="space-y-2">
                  {customerRetention.topLoyal.map((cust, idx) => (
                    <div key={cust.id} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{cust.name}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-brand-700 dark:text-brand-400">{cust.visitCount} Kunjungan</p>
                        <p className="text-[10px] text-slate-400">Total belanja: {formatRupiah(cust.totalSpent)}</p>
                      </div>
                    </div>
                  ))}
                  {customerRetention.topLoyal.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-4">Belum ada data pelanggan</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Row 3 - Left: Menu Profitability Table */}
            <div className="card p-5 flex flex-col">
              <div className="mb-4">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Grid size={18} className="text-brand-600" />
                  Profitabilitas Menu (30 Hari Terakhir)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Melihat profit absolut dan persentase margin laba per menu</p>
              </div>

              <div className="flex-1 overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-semibold bg-slate-50 dark:bg-slate-800/30">
                      <th className="py-2.5 px-2">Menu</th>
                      <th className="py-2.5 px-2 text-center">Terjual</th>
                      <th className="py-2.5 px-2 text-right">Omset</th>
                      <th className="py-2.5 px-2 text-right">Profit</th>
                      <th className="py-2.5 px-2 text-center">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {menuProfitability.slice(0, 10).map((menu, idx) => {
                      const isLowMargin = menu.margin < 30;
                      return (
                        <tr key={idx} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-700/20">
                          <td className="py-2.5 px-2 font-medium text-slate-700 dark:text-slate-200 truncate max-w-[120px]" title={menu.name}>
                            {menu.name}
                          </td>
                          <td className="py-2.5 px-2 text-center font-bold text-slate-600 dark:text-slate-305">
                            {Number.isInteger(menu.qty) ? menu.qty : menu.qty.toFixed(1)}x
                          </td>
                          <td className="py-2.5 px-2 text-right text-slate-500 dark:text-slate-400">{formatRupiah(menu.revenue)}</td>
                          <td className="py-2.5 px-2 text-right font-bold text-green-700 dark:text-green-400">{formatRupiah(menu.profit)}</td>
                          <td className="py-2.5 px-2 text-center">
                            <span
                              className={`badge ${
                                isLowMargin 
                                  ? 'bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/30' 
                                  : 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-900/30'
                              }`}
                            >
                              {menu.margin}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {menuProfitability.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-6 text-slate-400">
                          Belum ada transaksi menu dalam 30 hari terakhir.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Row 3 - Right: Stock Consumption & Forecast */}
            <div className="card p-5 flex flex-col">
              <div className="mb-4">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Package size={18} className="text-brand-600" />
                  Perkiraan Habis Bahan Baku (Forecasting)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Estimasi sisa hari pemakaian bahan baku berdasarkan rata-rata log keluar harian</p>
              </div>

              <div className="flex-1 overflow-y-auto max-h-[300px] space-y-3 pr-1">
                {stockForecast.map((item) => {
                  const isDepleted = item.stock <= 0;
                  const isCrit = item.daysRemaining < 3;
                  const isWarn = item.daysRemaining < 7;
                  
                  let statusColor = 'bg-green-500';
                  let badgeColor = 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900/30';
                  let daysText = `${Math.round(item.daysRemaining)} hari`;

                  if (isDepleted) {
                    statusColor = 'bg-red-600';
                    badgeColor = 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/30';
                    daysText = 'Habis';
                  } else if (item.daysRemaining === Infinity) {
                    statusColor = 'bg-slate-300';
                    badgeColor = 'bg-slate-50 dark:bg-slate-800 text-slate-505 dark:text-slate-400 border-slate-200 dark:border-slate-700';
                    daysText = 'Stabil (Jarang dipakai)';
                  } else if (isCrit) {
                    statusColor = 'bg-red-500';
                    badgeColor = 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/30';
                  } else if (isWarn) {
                    statusColor = 'bg-yellow-500';
                    badgeColor = 'bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-900/30';
                  }

                  return (
                    <div key={item.id} className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{item.name}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
                          Sisa: {item.stock} {item.unit}
                        </span>
                      </div>
                      
                      {/* Consumption progress bar */}
                      <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${statusColor} animate-progress`}
                          style={{
                            width: `${item.daysRemaining === Infinity ? 100 : Math.min(100, (item.daysRemaining / 30) * 100)}%`,
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 dark:text-slate-400">
                          Rata-rata: {item.dailyUsage.toFixed(2)} {item.unit}/hari
                        </span>
                        <span className={`badge border ${badgeColor}`}>
                          ⏳ {daysText}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {stockForecast.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-6">Tidak ada item inventaris.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
