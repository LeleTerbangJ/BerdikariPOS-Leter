import { useState, useMemo, useEffect, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { useMenuStore } from '../store/menuStore';
import { useCartStore } from '../store/cartStore';
import { useTransactionStore } from '../store/transactionStore';
import { useInventoryStore } from '../store/inventoryStore';
import { useAuthStore } from '../store/authStore';
import { useCustomerStore } from '../store/customerStore';
import { useSettingsStore } from '../store/settingsStore';
import { useToastStore } from '../store/toastStore';
import { usePromoStore } from '../store/promoStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { AtomicTransactionEngine } from '../lib/atomicTransactionEngine';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { formatRupiah } from '../utils/format';
import { createSnapshotForCartItems, calculateItemDeductions } from '../utils/hpp';
import { printReceipt, buildReceiptFromTransaction } from '../utils/printer';
import { checkStockAvailability, type StockWarning } from '../utils/stockCheck';
import type { Menu, CartItem, Temperature, SugarLevel, AddOn, PaymentMethod, OrderType } from '../types';
import Modal from '../components/Modal';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
  CreditCard,
  Banknote,
  QrCode,
  X,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  UtensilsCrossed,
  ShoppingBag as TakeAwayIcon,
} from 'lucide-react';

export default function POS() {
  const { menus } = useMenuStore();
  const { items: inventory } = useInventoryStore();
  const { deductStock } = useInventoryStore();
  const cart = useCartStore();
  const { addTransaction, getNextQueueNumber } = useTransactionStore();
  const { currentUser } = useAuthStore();
  const { customers, recordVisit } = useCustomerStore();
  const { settings } = useSettingsStore();
  const { addToast } = useToastStore();
  const { getActivePromos, getPromoByCode, incrementUsage, getCustomerDiscount } = usePromoStore();
  const { addLog } = useAuditLogStore();

  // Order type & Table features state
  const [orderType, setOrderType] = useState<OrderType>('Dine In');
  const [tableNumber, setTableNumber] = useState('');

  // GAP-3 fix: Real-time sync for menus, inventory, and customers (with GAP-2 auto-reconnect)
  // So Kasir sees changes from Manager's device even without navigating away
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let menuChannel: any;
    let invChannel: any;
    let custChannel: any;
    let settingsChannel: any;

    const setupSubscriptions = () => {
      if (menuChannel) supabase.removeChannel(menuChannel);
      if (invChannel) supabase.removeChannel(invChannel);
      if (custChannel) supabase.removeChannel(custChannel);
      if (settingsChannel) supabase.removeChannel(settingsChannel);

      menuChannel = supabase
        .channel('pos-menus-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'menus' }, () => {
          useMenuStore.getState().loadFromCloud(true);
        })
        .subscribe();

      invChannel = supabase
        .channel('pos-inventory-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => {
          useInventoryStore.getState().loadFromCloud(true);
        })
        .subscribe();

      custChannel = supabase
        .channel('pos-customers-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
          useCustomerStore.getState().loadFromCloud(true);
        })
        .subscribe();

      settingsChannel = supabase
        .channel('pos-settings-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => {
          useSettingsStore.getState().loadFromCloud();
          usePromoStore.getState().loadFromCloud(true); // loyalty settings also in settings table
          useMenuStore.getState().loadFromCloud(true); // custom categories also in settings table
        })
        .subscribe();
    };

    setupSubscriptions();

    const handleReconnect = () => {
      if (document.visibilityState === 'visible' || navigator.onLine) {
        console.log('[POS] Visibility or online restored, reconnecting subscriptions...');
        useMenuStore.getState().loadFromCloud(true);
        useInventoryStore.getState().loadFromCloud(true);
        useCustomerStore.getState().loadFromCloud(true);
        useSettingsStore.getState().loadFromCloud();
        setupSubscriptions();
      }
    };

    window.addEventListener('visibilitychange', handleReconnect);
    window.addEventListener('online', handleReconnect);

    return () => {
      if (menuChannel) supabase.removeChannel(menuChannel);
      if (invChannel) supabase.removeChannel(invChannel);
      if (custChannel) supabase.removeChannel(custChannel);
      if (settingsChannel) supabase.removeChannel(settingsChannel);
      window.removeEventListener('visibilitychange', handleReconnect);
      window.removeEventListener('online', handleReconnect);
    };
  }, []);

  // BUG-C5 fix: useCallback + proper dependency array instead of re-binding every render
  const handleCheckoutCb = useCallback(() => {
    if (cart.items.length === 0) return;
    if (orderType === 'Dine In' && settings.tableFeaturesEnabled && !tableNumber) {
      addToast('Silakan pilih nomor meja terlebih dahulu!', 'warning');
      return;
    }
    const warnings = checkStockAvailability(cart.items, menus, inventory);
    if (warnings.length > 0) {
      setStockWarnings(warnings);
      setShowStockWarning(true);
      return;
    }
    setShowCheckout(true);
  }, [cart.items, menus, inventory, orderType, tableNumber, settings.tableFeaturesEnabled, addToast]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        e.stopPropagation();
        handleCheckoutCb();
      }
      if (e.key === 'Escape') {
        setShowCheckout(false);
        setSelectedMenu(null);
        setMobileCartOpen(false);
      }
    };
    const helpHandler = (e: Event) => {
      e.preventDefault();
      return false;
    };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('help', helpHandler);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('help', helpHandler);
    };
  }, [handleCheckoutCb]);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Semua');
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutTxId, setCheckoutTxId] = useState<string>(() => uuid());

  // Mobile cart toggle
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Customer selection
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Customization state
  const [temp, setTemp] = useState<Temperature>('Dingin');
  const [sugar, setSugar] = useState<SugarLevel>('Normal');
  const [selectedAddons, setSelectedAddons] = useState<AddOn[]>([]);
  const [qty, setQty] = useState(1);

  // Checkout state
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Cash');
  const [cashReceived, setCashReceived] = useState('');
  const [discountInput, setDiscountInput] = useState('');
  const [stockWarnings, setStockWarnings] = useState<StockWarning[]>([]);
  const [showStockWarning, setShowStockWarning] = useState(false);

  // Promo/Voucher state
  const [voucherCode, setVoucherCode] = useState('');
  const [appliedPromoId, setAppliedPromoId] = useState<string | null>(null);
  const [promoError, setPromoError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  // Reset clear confirmation after 3 seconds (BUG-M4 fix)
  useEffect(() => {
    if (confirmClear) {
      const timer = setTimeout(() => setConfirmClear(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [confirmClear]);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  // Active promos for dropdown
  const activePromos = getActivePromos();

  // Calculate promo discount - memoized with useCallback (BUG-M2 fix)
  const calculatePromoDiscount = useCallback((promoId: string | null, subtotal: number): number => {
    if (!promoId) return 0;
    const promo = activePromos.find((p) => p.id === promoId);
    if (!promo) return 0;

    // Check min purchase
    if (promo.minPurchase && subtotal < promo.minPurchase) return 0;

    // Check loyalty requirement
    if (promo.scope === 'loyalty' && promo.loyaltyMinVisits) {
      if (!selectedCustomer || selectedCustomer.visitCount < promo.loyaltyMinVisits) return 0;
    }

    // LOGIC-3 fix: Validate promo scope against cart items
    if (promo.scope === 'category' && promo.scopeTarget) {
      const hasMatchingCategory = cart.items.some((item) => {
        const menu = menus.find((m) => m.id === item.menuId);
        return menu && menu.category === promo.scopeTarget;
      });
      if (!hasMatchingCategory) return 0;
    }
    if (promo.scope === 'menu' && promo.scopeTarget) {
      const hasMatchingMenu = cart.items.some((item) => item.menuId === promo.scopeTarget);
      if (!hasMatchingMenu) return 0;
    }

    let discount = 0;
    if (promo.type === 'percentage') {
      discount = Math.round(subtotal * promo.value / 100);
      if (promo.maxDiscount && discount > promo.maxDiscount) discount = promo.maxDiscount;
    } else {
      discount = promo.value;
    }
    return discount;
  }, [activePromos, selectedCustomer, cart.items, menus]);

  const promoDiscount = useMemo(() => calculatePromoDiscount(appliedPromoId, cart.getSubtotal()), [appliedPromoId, cart.items, calculatePromoDiscount]);

  const applyVoucherCode = () => {
    setPromoError('');
    if (!voucherCode.trim()) return;
    const promo = getPromoByCode(voucherCode.trim());
    if (!promo) {
      setPromoError('Kode voucher tidak valid atau sudah expired');
      return;
    }
    if (promo.minPurchase && cart.getSubtotal() < promo.minPurchase) {
      setPromoError(`Min. belanja ${formatRupiah(promo.minPurchase)}`);
      return;
    }
    setAppliedPromoId(promo.id);
    const disc = calculatePromoDiscount(promo.id, cart.getSubtotal());
    addToast(`Voucher "${promo.name}" diterapkan! -${formatRupiah(disc)}`, 'success');
  };

  const selectPromo = (promoId: string) => {
    if (promoId === '') {
      setAppliedPromoId(null);
      return;
    }
    setAppliedPromoId(promoId);
    setVoucherCode('');
    setPromoError('');
  };

  const clearPromo = () => {
    setAppliedPromoId(null);
    setVoucherCode('');
    setPromoError('');
  };

  // Loyalty discount (auto-applied if customer selected)
  // BUG-M2 fix: added getCustomerDiscount to deps (loyalty settings can change)
  const loyaltyDiscount = useMemo(() => {
    if (!selectedCustomer) return 0;
    const pct = getCustomerDiscount(selectedCustomer.visitCount);
    if (pct <= 0) return 0;
    return Math.round(cart.getSubtotal() * pct / 100);
  }, [selectedCustomer, cart.items, getCustomerDiscount]);

  // Preview queue number for checkout modal (read-only, no side effects)
  const queuePreview = useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const state = useTransactionStore.getState();
    if (state.lastQueueDate !== dateStr) return 1;
    return state.nextQueueNumber;
  }, [showCheckout]); // recalculate when checkout modal opens

  const categories = useMemo(() => {
    const cats = ['Semua', 'Best Seller', ...new Set(menus.map((m) => m.category))];
    return [...new Set(cats)];
  }, [menus]);

  const filteredMenus = useMemo(() => {
    let list = menus.filter((m) => m.isAvailable !== false); // hide unavailable
    if (category === 'Best Seller') list = list.filter((m) => m.isBestSeller);
    else if (category !== 'Semua') list = list.filter((m) => m.category === category);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q));
    }
    return list;
  }, [menus, category, search]);

  const openCustomize = (menu: Menu) => {
    setSelectedMenu(menu);
    setTemp('Dingin');
    setSugar('Normal');
    setSelectedAddons([]);
    setQty(1);
  };

  const addToCart = () => {
    if (!selectedMenu) return;
    const addonTotal = selectedAddons.reduce((a, b) => a + b.price, 0);
    const unitPrice = selectedMenu.price + addonTotal;
    const item: CartItem = {
      lineId: uuid(),
      menuId: selectedMenu.id,
      name: selectedMenu.name,
      basePrice: selectedMenu.price,
      quantity: qty,
      temperature: selectedMenu.showTemperature !== false ? temp : 'Hangat',
      sugar: selectedMenu.showSugarLevel !== false ? sugar : 'None',
      addons: selectedAddons,
      subtotal: unitPrice * qty,
      kitchenTarget: selectedMenu.kitchenTarget,
      showSugarLevel: selectedMenu.showSugarLevel !== false,
      showTemperature: selectedMenu.showTemperature !== false,
    };
    cart.addItem(item);
    setSelectedMenu(null);
    addToast(`${selectedMenu.name} ditambahkan ke keranjang`, 'success');
  };

  const toggleAddon = (addon: AddOn) => {
    setSelectedAddons((prev) =>
      prev.find((a) => a.name === addon.name)
        ? prev.filter((a) => a.name !== addon.name)
        : [...prev, addon]
    );
  };

  // handleCheckout now uses the memoized callback
  const handleCheckout = handleCheckoutCb;

  const proceedCheckoutAnyway = () => {
    setShowStockWarning(false);
    setStockWarnings([]);
    setShowCheckout(true);
  };

  const finalizeTransaction = async () => {
    if (orderType === 'Dine In' && settings.tableFeaturesEnabled && !tableNumber) {
      addToast('Silakan pilih nomor meja terlebih dahulu!', 'warning');
      return;
    }
    const manualDiscount = parseInt(discountInput) || 0;
    const rawTotalDiscount = Math.round(manualDiscount + promoDiscount + loyaltyDiscount);
    const subtotal = Math.round(cart.getSubtotal());
    // LOGIC-2 & LOGIC-05 fix: Cap total discount to never exceed subtotal & round to whole integer
    const totalDiscount = Math.round(Math.min(rawTotalDiscount, subtotal));
    const netSubtotal = Math.round(Math.max(0, subtotal - totalDiscount));
    
    // GAP-3 & LOGIC-05 fix: Calculate tax rounded to whole integer Rupiah
    const isTaxActive = settings.taxEnabled !== false && (settings.taxPercent || 0) > 0;
    const taxPercent = isTaxActive ? (settings.taxPercent || 0) : 0;
    const taxAmount = Math.round((netSubtotal * taxPercent) / 100);
    const total = Math.round(netSubtotal + taxAmount);
    const cash = parseInt(cashReceived) || 0;

    // Safety guard: Cash payment must have sufficient funds
    if (payMethod === 'Cash' && cash < total) return;

    // Pre-open print window BEFORE any async calls to avoid popup blocker
    let preOpenedPrintWindow: Window | null = null;
    if ((settings.printerEnabled || settings.autoPrintOnCheckout) && settings.printerType !== 'bluetooth') {
      preOpenedPrintWindow = window.open('', '_blank', 'width=400,height=600');
    }

    // Execute Atomic Checkout via AtomicTransactionEngine
    const result = await AtomicTransactionEngine.executeCheckout({
      transactionId: checkoutTxId,
      cartItems: cart.items,
      subtotal,
      discount: totalDiscount,
      taxAmount,
      totalAmount: total,
      payMethod,
      cashReceived: cash,
      orderType,
      tableNumber: orderType === 'Dine In' && settings.tableFeaturesEnabled ? tableNumber : undefined,
      selectedCustomerId: selectedCustomerId || undefined,
      selectedCustomerName: selectedCustomer?.name || undefined,
      currentUser,
      settings,
      preOpenedPrintWindow,
    });

    if (!result.success) {
      if (preOpenedPrintWindow && !preOpenedPrintWindow.closed) {
        preOpenedPrintWindow.close();
      }
      if (result.warnings && result.warnings.length > 0) {
        setStockWarnings(result.warnings);
        setShowStockWarning(true);
      } else {
        addToast(result.error || 'Gagal memproses transaksi!', 'error');
      }
      return;
    }

    const tx = result.transaction!;

    // Record customer visit
    if (selectedCustomerId) {
      recordVisit(selectedCustomerId, total);
    }

    // Increment promo usage
    if (appliedPromoId) {
      incrementUsage(appliedPromoId);
    }

    // Clear cart & reset state with fresh transaction ID for next checkout
    cart.clearCart();
    setShowCheckout(false);
    setDiscountInput('');
    setVoucherCode('');
    setCashReceived('');
    setSelectedCustomerId(null);
    setTableNumber('');
    setCheckoutTxId(uuid());

    setPayMethod('Cash');
    clearPromo();
    setOrderType('Dine In');

    addToast(
      result.idempotentReplay
        ? `Transaksi #${tx.queueNumber} sudah diproses sebelumnya.`
        : `Transaksi #${tx.queueNumber} berhasil! 🎉`,
      'success'
    );
  };

  const isTaxActive = settings.taxEnabled !== false && (settings.taxPercent || 0) > 0;
  const taxPercent = isTaxActive ? (settings.taxPercent || 0) : 0;
  // LOGIC-ERR-02 fix: Use same capping formula as finalizeTransaction()
  const rawPreviewDiscount = (parseInt(discountInput) || 0) + promoDiscount + loyaltyDiscount;
  const cappedPreviewDiscount = Math.min(rawPreviewDiscount, cart.getSubtotal());
  const netSubtotal = Math.max(0, cart.getSubtotal() - cappedPreviewDiscount);
  const taxAmount = Math.round((netSubtotal * taxPercent) / 100);
  const finalTotal = netSubtotal + taxAmount;

  return (
    <div className="flex flex-col lg:flex-row gap-0 lg:gap-4 h-full -m-4 lg:-m-6">
      {/* Left: Product Catalog */}
      <div className="flex-1 flex flex-col p-4 lg:p-6 overflow-hidden">
        {/* Search & Filter */}
        <div className="mb-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari menu..."
              className="input pl-10"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition ${
                  category === cat
                    ? 'bg-brand-600 text-white'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredMenus.map((menu) => {
              const initials = menu.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
              return (
                <button
                  key={menu.id}
                  onClick={() => openCustomize(menu)}
                  className="card p-4 text-left hover:shadow-md hover:border-brand-200 dark:hover:border-brand-800 transition group animate-fade-in"
                >
                  <div className="w-full aspect-square rounded-xl bg-gradient-to-br from-brand-100 to-brand-200 dark:from-brand-900/30 dark:to-brand-950/40 mb-3 flex items-center justify-center overflow-hidden">
                    {menu.image ? (
                      <img src={menu.image} alt={menu.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl font-bold text-brand-400 dark:text-brand-300">{initials}</span>
                    )}
                  </div>
                  {menu.isBestSeller && (
                    <span className="badge bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 mb-1">⭐ Best Seller</span>
                  )}
                  <h3 className="font-semibold text-sm leading-tight mb-1 text-slate-800 dark:text-slate-200 group-hover:text-brand-700 dark:group-hover:text-brand-400 transition">
                    {menu.name}
                  </h3>
                  <p className="text-brand-600 dark:text-brand-450 font-bold text-sm">{formatRupiah(menu.price)}</p>
                </button>
              );
            })}
          </div>
          {filteredMenus.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <p>Menu tidak ditemukan</p>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: Floating Cart Bar (minimized) */}
      {cart.items.length > 0 && !mobileCartOpen && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 p-3 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700/50 shadow-lg">
          <button
            onClick={() => setMobileCartOpen(true)}
            className="w-full flex items-center justify-between bg-brand-600 text-white rounded-xl px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <ShoppingBag size={20} />
              <span className="font-semibold">{cart.items.length} item</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold">{formatRupiah(finalTotal)}</span>
              <ChevronUp size={18} />
            </div>
          </button>
        </div>
      )}

      {/* Mobile: Expanded Cart (overlay) */}
      {mobileCartOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileCartOpen(false)} />
          <div className="relative mt-auto bg-white dark:bg-slate-850 rounded-t-2xl max-h-[85vh] flex flex-col shadow-xl animate-in slide-in-from-bottom duration-200">
            {/* Cart Header */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <ShoppingBag size={20} className="text-brand-600 dark:text-brand-400" />
                Keranjang
                <span className="badge bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300">{cart.items.length}</span>
              </h2>
              <div className="flex items-center gap-1">
                {cart.items.length >= 2 && (
                  <button
                    onClick={() => {
                      if (confirmClear) {
                        cart.clearCart();
                        setConfirmClear(false);
                        addToast('Keranjang dikosongkan', 'info');
                      } else {
                        setConfirmClear(true);
                        addToast('Klik sekali lagi untuk mengosongkan keranjang', 'warning');
                      }
                    }}
                    className={`p-2 rounded-lg transition ${
                      confirmClear
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                        : 'hover:bg-red-50 dark:hover:bg-red-950/20 text-red-400 hover:text-red-650'
                    }`}
                    title={confirmClear ? "Klik lagi untuk Konfirmasi" : "Kosongkan Keranjang"}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                <button onClick={() => setMobileCartOpen(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400">
                  <ChevronDown size={20} />
                </button>
              </div>
            </div>

            {/* Customer Selection */}
            <div className="px-4 pt-3 space-y-2">
              <select
                value={selectedCustomerId || ''}
                onChange={(e) => setSelectedCustomerId(e.target.value || null)}
                className="input text-sm"
              >
                <option value="">-- Pelanggan (opsional) --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.phone ? ` (${c.phone})` : ''}
                  </option>
                ))}
              </select>

              {/* Tipe Pesanan & Nomor Meja (Mobile View Fix) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-1">Tipe</label>
                  <select
                    value={orderType}
                    onChange={(e) => {
                      const val = e.target.value as OrderType;
                      setOrderType(val);
                      if (val === 'Take Away') setTableNumber('');
                    }}
                    className="input text-xs"
                  >
                    <option value="Dine In">Dine In</option>
                    <option value="Take Away">Take Away</option>
                  </select>
                </div>

                {settings.tableFeaturesEnabled && orderType === 'Dine In' && (
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-1">Meja</label>
                    <select
                      value={tableNumber}
                      onChange={(e) => setTableNumber(e.target.value)}
                      className="input text-xs"
                    >
                      <option value="">-- Pilih Meja --</option>
                      {(settings.availableTableNumbers || []).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Cart Items */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.items.map((item) => (
                <div key={item.lineId} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3">
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-slate-850 dark:text-slate-200 truncate">{item.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {item.showTemperature !== false ? item.temperature : ''}{item.showTemperature !== false && item.showSugarLevel !== false ? ' • ' : ''}{item.showSugarLevel !== false ? `Gula ${item.sugar}` : ''}
                        {item.addons.length > 0 && ` • +${item.addons.map((a) => a.name).join(', ')}`}
                      </p>
                    </div>
                    <button onClick={() => cart.removeItem(item.lineId)} className="p-1 text-red-400 hover:text-red-650 transition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { if (item.quantity <= 1) cart.removeItem(item.lineId); else cart.updateQuantity(item.lineId, item.quantity - 1); }}
                        className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center dark:text-slate-300 dark:hover:bg-slate-700 transition"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="text-sm font-semibold w-5 text-center text-slate-800 dark:text-slate-200">{item.quantity}</span>
                      <button
                        onClick={() => cart.updateQuantity(item.lineId, item.quantity + 1)}
                        className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center dark:text-slate-300 dark:hover:bg-slate-700 transition"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <p className="font-semibold text-sm text-brand-700 dark:text-brand-400">{formatRupiah(item.subtotal)}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Cart Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
              {/* Promo/Voucher */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={voucherCode}
                    onChange={(e) => { setVoucherCode(e.target.value.toUpperCase()); setPromoError(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && applyVoucherCode()}
                    placeholder="Kode voucher"
                    className="input text-sm flex-1 font-mono"
                  />
                  <button onClick={applyVoucherCode} className="btn-secondary text-xs" disabled={!voucherCode}>OK</button>
                </div>
                {activePromos.length > 0 && !appliedPromoId && (
                  <select onChange={(e) => selectPromo(e.target.value)} className="input text-xs" value="">
                    <option value="">Pilih promo...</option>
                    {activePromos.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.type === 'percentage' ? `${p.value}%` : formatRupiah(p.value)})</option>
                    ))}
                  </select>
                )}
                {appliedPromoId && (
                  <div className="flex items-center justify-between p-2 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/30 rounded-lg text-xs">
                    <span className="text-green-700 dark:text-green-400 font-medium">✓ {activePromos.find(p => p.id === appliedPromoId)?.name} (-{formatRupiah(promoDiscount)})</span>
                    <button onClick={clearPromo} className="text-red-500 hover:underline">Hapus</button>
                  </div>
                )}
                {promoError && <p className="text-xs text-red-500">{promoError}</p>}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="Diskon manual (Rp)"
                  className="input text-sm flex-1"
                />
              </div>
              {/* BUG-NEW-06 fix: Show loyalty discount in mobile cart */}
              {loyaltyDiscount > 0 && (
                <div className="p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-lg text-xs text-amber-700 dark:text-amber-400 font-medium">
                  👑 Loyalty discount: -{formatRupiah(loyaltyDiscount)}
                </div>
              )}
              {taxPercent > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Pajak ({taxPercent}%)</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{formatRupiah(taxAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg text-slate-800 dark:text-slate-200">
                <span>Total</span>
                <span className="text-brand-700 dark:text-brand-400">
                  {formatRupiah(finalTotal)}
                </span>
              </div>
              <button onClick={() => { setMobileCartOpen(false); handleCheckout(); }} className="btn-primary w-full text-base">
                <CreditCard size={18} /> Bayar
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="hidden lg:flex w-96 bg-white dark:bg-slate-800 border-l border-slate-100 dark:border-slate-700/50 flex-col">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700/50">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg flex items-center gap-2 text-slate-850 dark:text-slate-200">
              <ShoppingBag size={20} className="text-brand-600 dark:text-brand-400" />
              Keranjang
              {cart.items.length > 0 && (
                <span className="badge bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300">{cart.items.length}</span>
              )}
            </h2>
            {/* FEAT-4: Clear all cart button (desktop) */}
            {cart.items.length >= 2 && (
              <button
                onClick={() => {
                  if (confirmClear) {
                    cart.clearCart();
                    setConfirmClear(false);
                    addToast('Keranjang dikosongkan', 'info');
                  } else {
                    setConfirmClear(true);
                    addToast('Klik sekali lagi untuk mengosongkan keranjang', 'warning');
                  }
                }}
                className={`p-1.5 rounded-lg transition ${
                  confirmClear
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                    : 'hover:bg-red-50 dark:hover:bg-red-950/20 text-red-400 hover:text-red-600'
                }`}
                title={confirmClear ? "Klik lagi untuk Konfirmasi" : "Kosongkan Keranjang"}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>

          {/* Customer Selection - Dropdown */}
          <div className="mt-3">
            <select
              value={selectedCustomerId || ''}
              onChange={(e) => setSelectedCustomerId(e.target.value || null)}
              className="input text-sm"
            >
              <option value="">-- Pelanggan (opsional) --</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.phone ? ` (${c.phone})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Tipe Pesanan & Nomor Meja */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-1">Tipe</label>
              <select
                value={orderType}
                onChange={(e) => {
                  const val = e.target.value as OrderType;
                  setOrderType(val);
                  if (val === 'Take Away') setTableNumber('');
                }}
                className="input text-xs"
              >
                <option value="Dine In">Dine In</option>
                <option value="Take Away">Take Away</option>
              </select>
            </div>

            {settings.tableFeaturesEnabled && orderType === 'Dine In' && (
              <div>
                <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-1">Meja</label>
                <select
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  className="input text-xs"
                >
                  <option value="">-- Pilih --</option>
                  {(settings.availableTableNumbers || []).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.items.length === 0 ? (
            <div className="text-center py-12 text-slate-400 dark:text-slate-500">
              <ShoppingBag size={40} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Keranjang kosong</p>
            </div>
          ) : (
            cart.items.map((item) => (
              <div key={item.lineId} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3">
                <div className="flex justify-between items-start mb-1">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-slate-800 dark:text-slate-200 truncate">{item.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {item.showTemperature !== false ? item.temperature : ''}{item.showTemperature !== false && item.showSugarLevel !== false ? ' • ' : ''}{item.showSugarLevel !== false ? `Gula ${item.sugar}` : ''}
                      {item.addons.length > 0 && ` • +${item.addons.map((a) => a.name).join(', ')}`}
                    </p>
                  </div>
                  <button
                    onClick={() => cart.removeItem(item.lineId)}
                    className="p-1 text-red-400 hover:text-red-650 transition"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (item.quantity <= 1) cart.removeItem(item.lineId);
                        else cart.updateQuantity(item.lineId, item.quantity - 1);
                      }}
                      className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center dark:text-slate-300 dark:hover:bg-slate-700 transition"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="text-sm font-semibold w-5 text-center text-slate-800 dark:text-slate-200">{item.quantity}</span>
                    <button
                      onClick={() => cart.updateQuantity(item.lineId, item.quantity + 1)}
                      className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center dark:text-slate-300 dark:hover:bg-slate-700 transition"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                  <p className="font-semibold text-sm text-brand-700 dark:text-brand-400">{formatRupiah(item.subtotal)}</p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Cart Footer */}
        {cart.items.length > 0 && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-850 space-y-3">
            {/* Promo/Voucher */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={voucherCode}
                  onChange={(e) => { setVoucherCode(e.target.value.toUpperCase()); setPromoError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && applyVoucherCode()}
                  placeholder="Kode voucher"
                  className="input text-sm flex-1 font-mono"
                />
                <button onClick={applyVoucherCode} className="btn-secondary text-xs" disabled={!voucherCode}>OK</button>
              </div>
              {activePromos.length > 0 && !appliedPromoId && (
                <select onChange={(e) => selectPromo(e.target.value)} className="input text-xs" value="">
                  <option value="">Pilih promo aktif...</option>
                  {activePromos.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.type === 'percentage' ? `${p.value}%` : formatRupiah(p.value)})</option>
                  ))}
                </select>
              )}
              {appliedPromoId && (
                <div className="flex items-center justify-between p-2 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/30 rounded-lg text-xs">
                  <span className="text-green-700 dark:text-green-400 font-medium">✓ {activePromos.find(p => p.id === appliedPromoId)?.name} (-{formatRupiah(promoDiscount)})</span>
                  <button onClick={clearPromo} className="text-red-500 hover:underline">Hapus</button>
                </div>
              )}
              {loyaltyDiscount > 0 && (
                <div className="p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-lg text-xs text-amber-700 dark:text-amber-400 font-medium">
                  👑 Loyalty discount: -{formatRupiah(loyaltyDiscount)}
                </div>
              )}
              {promoError && <p className="text-xs text-red-500">{promoError}</p>}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value.replace(/\D/g, ''))}
                placeholder="Diskon manual (Rp)"
                className="input text-sm flex-1"
              />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">Subtotal</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">{formatRupiah(cart.getSubtotal())}</span>
            </div>
            {(parseInt(discountInput) > 0 || promoDiscount > 0 || loyaltyDiscount > 0) && (
              <div className="flex justify-between text-sm">
                <span className="text-red-500">Total Diskon</span>
                <span className="text-red-500">-{formatRupiah(cappedPreviewDiscount)}</span>
              </div>
            )}
            {taxPercent > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Pajak ({taxPercent}%)</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">{formatRupiah(taxAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg text-slate-800 dark:text-slate-200">
              <span>Total</span>
              <span className="text-brand-700 dark:text-brand-400">
                {formatRupiah(finalTotal)}
              </span>
            </div>
            <button onClick={handleCheckout} className="btn-primary w-full text-base">
              <CreditCard size={18} /> Bayar
            </button>
          </div>
        )}
      </div>

      {/* Customization Modal */}
      <Modal
        open={!!selectedMenu}
        onClose={() => setSelectedMenu(null)}
        title={selectedMenu?.name || ''}
        maxWidth="max-w-md"
      >
        {selectedMenu && (
          <div className="space-y-5">
            {/* Temperature */}
            {selectedMenu.showTemperature !== false && (
            <div>
              <label className="label text-slate-700 dark:text-slate-300">Suhu</label>
              <div className="flex gap-2">
                {(['Hangat', 'Dingin'] as Temperature[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTemp(t)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition ${
                      temp === t
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-205 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {t === 'Hangat' ? '🔥' : '🧊'} {t}
                  </button>
                ))}
              </div>
            </div>
            )}

            {/* Sugar Level */}
            {selectedMenu.showSugarLevel !== false && (
              <div>
                <label className="label text-slate-700 dark:text-slate-300">Level Gula</label>
                <div className="flex gap-2">
                  {(['Normal', 'Less', 'None'] as SugarLevel[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSugar(s)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition ${
                        sugar === s
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-205 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Add-ons */}
            {selectedMenu.availableAddons.length > 0 && (
              <div>
                <label className="label text-slate-700 dark:text-slate-300">Add-ons</label>
                <div className="space-y-2">
                  {selectedMenu.availableAddons.map((addon) => {
                    const active = selectedAddons.find((a) => a.name === addon.name);
                    return (
                      <button
                        key={addon.name}
                        onClick={() => toggleAddon(addon)}
                        className={`w-full flex items-center justify-between p-3 rounded-xl border transition ${
                          active
                            ? 'bg-brand-50 dark:bg-brand-950/20 border-brand-300 dark:border-brand-900/50'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-705'
                        }`}
                      >
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{addon.name}</span>
                        <span className="text-sm text-brand-600 dark:text-brand-400 font-bold">+{formatRupiah(addon.price)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quantity */}
            <div>
              <label className="label text-slate-700 dark:text-slate-300">Jumlah</label>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-750 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center transition"
                >
                  <Minus size={16} />
                </button>
                <span className="text-xl font-bold w-8 text-center text-slate-800 dark:text-slate-200">{qty}</span>
                <button
                  onClick={() => setQty(qty + 1)}
                  className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-750 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center transition"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            {/* Total & Add */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Total</p>
                <p className="text-xl font-bold text-brand-700 dark:text-brand-400">
                  {formatRupiah(
                    (selectedMenu.price + selectedAddons.reduce((a, b) => a + b.price, 0)) * qty
                  )}
                </p>
              </div>
              <button onClick={addToCart} className="btn-primary">
                <Plus size={16} /> Tambah
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Checkout Modal */}
      <Modal
        open={showCheckout}
        onClose={() => setShowCheckout(false)}
        title="Pembayaran"
        maxWidth="max-w-md"
      >
        <div className="space-y-5">
          <div className="bg-brand-50 dark:bg-brand-950/20 border border-brand-100 dark:border-brand-900/30 rounded-xl p-4 text-center">
            <p className="text-sm text-slate-605 dark:text-slate-400">Total Pembayaran</p>
            <p className="text-3xl font-bold text-brand-700 dark:text-brand-400">
              {formatRupiah(finalTotal)}
            </p>
            {taxPercent > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Sudah termasuk Pajak ({taxPercent}%): {formatRupiah(taxAmount)}
              </p>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Antrean #{queuePreview}</p>
            {selectedCustomer && (
              <p className="text-xs text-brand-600 dark:text-brand-400 mt-1">Pelanggan: {selectedCustomer.name}</p>
            )}
          </div>

          {/* Order Type (Dine In / Take Away) */}
          <div>
            <label className="label text-slate-700 dark:text-slate-300">Tipe Pesanan</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { type: 'Dine In' as OrderType, icon: UtensilsCrossed, label: 'Dine In' },
                { type: 'Take Away' as OrderType, icon: TakeAwayIcon, label: 'Take Away' },
              ]).map(({ type, icon: Icon, label }) => (
                <button
                  key={type}
                  onClick={() => setOrderType(type)}
                  className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition ${
                    orderType === type
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <Icon size={18} />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Table Number (if Dine In & enabled) */}
          {settings.tableFeaturesEnabled && orderType === 'Dine In' && (
            <div>
              <label className="label text-slate-700 dark:text-slate-300">Nomor Meja</label>
              <select
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                className="input"
              >
                <option value="">-- Pilih Meja --</option>
                {(settings.availableTableNumbers || []).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Payment Method */}
          <div>
            <label className="label text-slate-700 dark:text-slate-300">Metode Pembayaran</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { method: 'Cash' as PaymentMethod, icon: Banknote, label: 'Cash' },
                { method: 'QRIS' as PaymentMethod, icon: QrCode, label: 'QRIS' },
                { method: 'Transfer' as PaymentMethod, icon: CreditCard, label: 'Transfer' },
              ]).map(({ method, icon: Icon, label }) => (
                <button
                  key={method}
                  onClick={() => setPayMethod(method)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition ${
                    payMethod === method
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-202 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <Icon size={20} />
                  <span className="text-xs font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Cash Calculator */}
          {payMethod === 'Cash' && (
            <div>
              <label className="label text-slate-700 dark:text-slate-300">Uang Diterima</label>
              <input
                type="text"
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value.replace(/\D/g, ''))}
                placeholder="Masukkan nominal"
                className="input text-lg font-semibold"
                autoFocus
              />
              {parseInt(cashReceived) > 0 && (
                <div className="mt-3 p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/30 rounded-xl">
                  <div className="flex justify-between">
                    <span className="text-sm text-green-700 dark:text-green-400">Kembalian</span>
                    <span className="font-bold text-green-700 dark:text-green-400">
                      {formatRupiah(Math.max(0, parseInt(cashReceived) - finalTotal))}
                    </span>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 mt-3">
                {(() => {
                  const suggestions: number[] = [];
                  const t = finalTotal;
                  // 1. Uang pas (exact amount)
                  suggestions.push(t);
                  // 2. Generate rounded-up denominations
                  const denominators = [5000, 10000, 20000, 50000, 100000];
                  for (const d of denominators) {
                    const rounded = Math.ceil(t / d) * d;
                    if (rounded > t && !suggestions.includes(rounded)) {
                      suggestions.push(rounded);
                    }
                  }
                  // Take top 3 unique suggestions
                  return suggestions.slice(0, 3).map((v) => (
                    <button
                      key={v}
                      onClick={() => setCashReceived(String(v))}
                      className="btn-secondary text-xs"
                    >
                      {formatRupiah(v)}
                    </button>
                  ));
                })()}
              </div>
            </div>
          )}

          {/* Finalize */}
          <button
            onClick={finalizeTransaction}
            disabled={
              payMethod === 'Cash' &&
              (!cashReceived || (parseInt(cashReceived) || 0) < finalTotal)
            }
            className="btn-primary w-full text-base"
          >
            Selesaikan Pesanan
          </button>
        </div>
      </Modal>

      {/* Stock Warning Modal */}
      <Modal
        open={showStockWarning}
        onClose={() => setShowStockWarning(false)}
        title="⚠️ Peringatan Stok"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-650 dark:text-slate-350">
            Beberapa bahan baku tidak mencukupi untuk pesanan ini:
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {stockWarnings.map((w) => (
              <div key={w.ingredientId} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl">
                <div>
                  <p className="font-medium text-sm text-red-800 dark:text-red-300">{w.ingredientName}</p>
                  <p className="text-xs text-red-650 dark:text-red-400">
                    Butuh: {w.required.toFixed(2)} {w.unit} • Tersedia: {w.available.toFixed(2)} {w.unit}
                  </p>
                </div>
                <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
              </div>
            ))}
          </div>
          <div className="flex gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button onClick={() => setShowStockWarning(false)} className="btn-secondary flex-1">
              Kembali
            </button>
            <button onClick={proceedCheckoutAnyway} className="btn-primary flex-1 bg-amber-600 hover:bg-amber-700">
              Lanjutkan Tetap
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
