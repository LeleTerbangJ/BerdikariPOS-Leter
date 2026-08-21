import { useState, useMemo, useEffect, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { useSearchParams } from 'react-router-dom';
import { useMenuStore } from '../store/menuStore';
import { useCartStore } from '../store/cartStore';
import { useTransactionStore, isPendingTransaction } from '../store/transactionStore';
// v4.7 TO DO 17.3: restore konteks resume pending setelah remount (anti transaksi duplikat)
import { resolveResumeRestore } from '../utils/pendingResume';
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
import { releaseSplitReserveForCart, computeCartSignature } from '../utils/splitStockSession';
// v4.7 TO DO 18.8 (A10): keputusan skip tiket dapur saat resume berbasis fakta (kitchenTicketPrintedAt)
import { shouldSkipKitchenPrintAtResume, hasNewKitchenItems, calculateDeltaKitchenItems, mergeKitchenItemStatus, hasNewStatusItems } from '../utils/kitchenTicket';
import { createBundleChildCartItems, buildBundleComponentsSnapshot } from '../lib/bundleService';
import { printReceipt, buildReceiptFromTransaction } from '../utils/printer';
// v4.7 TO DO 11.2 (P0.4): struk digital — auto-kirim WA pasca-checkout (Settings)
import { buildReceiptText, buildWhatsAppUrl, autoSendReceiptTarget } from '../utils/digitalReceipt';
import { checkStockAvailability, type StockWarning } from '../utils/stockCheck';
import { buildCategoryTabs, reorderTabs } from '../utils/categoryOrder';
// v4.7 TO DO 12.2.3 (P-A4): satu sumber kebenaran total diskon (stacking vs best-deal promo eksklusif)
import { calculateDiscountBreakdown } from '../utils/discountEngine';
import ConfirmDialog from '../components/ConfirmDialog';
// v4.7 TO DO 12.2.5 (P-A5): satu sumber kebenaran diskon PROMO (percentage/fixed/BOGO + min-qty)
import { calculatePromoDiscount as calcPromoDiscount } from '../utils/promoDiscount';
// v4.7 TO DO 12.2.2 (P-A8): poin loyalty — earn (di customerStore.recordVisit) & redeem di POS
import { calculateMaxRedeemablePoints, calculateRedeemDiscount } from '../utils/loyaltyPoints';
import type { Menu, CartItem, Temperature, SugarLevel, AddOn, PaymentMethod, OrderType, Transaction, AtomicCheckoutParams, Customer, KitchenStatus } from '../types';
import Modal from '../components/Modal';
import PendingPaymentsModal from '../components/PendingPaymentsModal';
import SplitBillModal from '../components/SplitBillModal';
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
  Clock,
  Scissors,
  FileText,
  UserPlus,
  FlaskConical,
  Tag,
  Printer,
} from 'lucide-react';

// v4.7 UX: pemilih pelanggan yang bisa dicari (nama / HP / email) — hemat waktu kasir
function CustomerPicker({
  customers,
  value,
  customName,
  onSelect,
  onSelectCustom,
}: {
  customers: Customer[];
  value: string | null;
  customName: string;
  onSelect: (id: string | null) => void;
  onSelectCustom: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = customers.find((c) => c.id === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone || '').includes(query.trim()) ||
        (c.email || '').toLowerCase().includes(q)
    );
  }, [customers, query]);

  const handleSelect = (id: string | null) => {
    onSelect(id);
    setQuery('');
    setOpen(false);
  };

  const handleSelectCustom = (name: string) => {
    onSelectCustom(name);
    onSelect(null);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="flex-1 relative">
      <input
        value={open ? query : (selected?.name || customName || '')}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && open) {
            e.preventDefault();
            if (filtered.length > 0) {
              handleSelect(filtered[0].id);
            } else if (query.trim()) {
              handleSelectCustom(query.trim());
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder="-- Cari pelanggan (nama/HP) --"
        className="input text-sm w-full"
      />
      {open && (
        <div className="mt-1 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 shadow-lg max-h-52 overflow-y-auto z-20 absolute left-0 right-0">
          <button
            type="button"
            onClick={() => {
              onSelectCustom('');
              handleSelect(null);
            }}
            className="w-full text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-800"
          >
            {value || customName ? '✕ Lepaskan pelanggan' : '— Tanpa pelanggan —'}
          </button>
          
          {query.trim() && (
            <button
              type="button"
              onClick={() => handleSelectCustom(query.trim())}
              className="w-full text-left px-3 py-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-slate-50 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5"
            >
              <span>✨ Gunakan nama:</span>
              <span className="underline font-semibold">{query.trim()}</span>
              <span className="text-xs text-slate-400 font-normal ml-auto">(Non-Pelanggan)</span>
            </button>
          )}

          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">Tidak ada pelanggan cocok</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleSelect(c.id)}
                className={`w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 ${
                  c.id === value ? 'bg-brand-50 dark:bg-brand-950/30' : ''
                }`}
              >
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{c.name}</span>
                <span className="text-xs text-slate-400 ml-2">
                  {c.phone || c.email || ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function POS() {
  const { menus, customCategories, reorderCategories } = useMenuStore();
  const { items: inventory } = useInventoryStore();
  const { deductStock } = useInventoryStore();
  const cart = useCartStore();
  const { addTransaction, getNextQueueNumber } = useTransactionStore();
  const { currentUser } = useAuthStore();
  const { customers, addCustomer, recordVisit, deductLoyaltyPoints } = useCustomerStore();
  const { settings } = useSettingsStore();
  const { addToast } = useToastStore();
  const { promos, getActivePromos, getPromoByCode, reservePromoUsage, getCustomerDiscount, loyaltySettings } = usePromoStore();
  const { addLog } = useAuditLogStore();

  // Order type & Table features state
  const [orderType, setOrderType] = useState<OrderType>('Dine In');
  const [tableNumber, setTableNumber] = useState('');

  // Pending & Split Bill Modals State
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [showPendingPrintModal, setShowPendingPrintModal] = useState(false);
  const [currentPendingTx, setCurrentPendingTx] = useState<Transaction | null>(null);
  // v4.7 TO DO 21.3: flag rekonsiliasi split pending — jika true, POS.tsx skip reservedDeductions
  // saat finalisasi pending (stok sudah disesuaikan oleh SplitBillModal → anti double-adjust).
  const [pendingSplitReconciled, setPendingSplitReconciled] = useState(false);

  // v4.1 TO DO 3.1: selector primitive yang stabil — hasil number, re-render hanya saat count berubah
  // (s.transactions + useMemo malah re-render pada tiap mutasi transaksi, termasuk kitchenStatus KDS).
  const pendingCount = useTransactionStore((s) => s.transactions.filter(isPendingTransaction).length);

  // Buka modal Pesanan Gantung saat diakses dari quick-access badge di sidebar (/pos?openPending=1)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('openPending') === '1') {
      setShowPendingModal(true);
      setSearchParams({}, { replace: true }); // Bersihkan param agar refresh/back tidak membuka ulang
    }
  }, [searchParams, setSearchParams]);

  // Deteksi perubahan item cart vs pesanan pending yang sedang dimuat.
  // Dipakai untuk keputusan status KDS: item berubah → reset ke 'Waiting' agar dapur melihat ulang,
  // item sama → pertahankan status dapur (tidak mengganggu proses memasak / alarm).
  // v4.5 TO DO 5.6: pakai computeCartSignature (splitStockSession) — satu sumber kebenaran signature
  // yang menyertakan suhu & level gula. Sebelumnya hanya menuId:quantity:addons → ubah suhu/gula
  // tidak terdeteksi → status dapur dipertahankan padahal spesifikasi masak berbeda.
  const pendingItemsChanged = useMemo(() => {
    if (!currentPendingTx) return true;
    return computeCartSignature(cart.items) !== computeCartSignature(currentPendingTx.items);
  }, [cart.items, currentPendingTx]);

  // Save Cart as Pending Transaction
  const handleSavePending = async (printOverride?: { skipReceiptPrint?: boolean; skipKitchenPrint?: boolean }) => {
    if (cart.items.length === 0) return;
    if (orderType === 'Dine In' && settings.tableFeaturesEnabled && !tableNumber) {
      addToast('Silakan pilih nomor meja untuk menyimpan pesanan gantung!', 'warning');
      return;
    }

    const pendingOption = settings.pendingPrintOption || 'dapur_only';

    // Jika opsi diatur ke 'ask' dan belum ada override pilihan dari modal
    if (pendingOption === 'ask' && !printOverride) {
      setShowPendingPrintModal(true);
      return;
    }

    // Tentukan flag pencetakan berdasarkan setting atau override
    let skipReceiptPrint = false;
    let skipKitchenPrint = false;

    if (printOverride) {
      skipReceiptPrint = !!printOverride.skipReceiptPrint;
      skipKitchenPrint = !!printOverride.skipKitchenPrint;
    } else if (pendingOption === 'dapur_only') {
      skipReceiptPrint = true; // Struk kasir TIDAK dicetak langsung
      skipKitchenPrint = false; // Tiket dapur dicetak
    } else if (pendingOption === 'dapur_and_cashier') {
      skipReceiptPrint = false;
      skipKitchenPrint = false;
    } else if (pendingOption === 'none') {
      skipReceiptPrint = true;
      skipKitchenPrint = true;
    }

    const subtotal = Math.round(cart.getSubtotal());
    // v4.7 TO DO 12.2.3 (P-A4): total diskon dari discount engine (stacking / best-deal), capped subtotal
    // v4.7 TO DO 12.2.2 (P-A8): + diskon redeem poin loyalty (selalu bertumpuk di atas diskon lain,
    // dibatasi headroom oleh maxRedeemPoints sehingga terpakai penuh tanpa potongan parsial poin).
    const totalDiscount = Math.min(discountCalc.totalDiscount + redeemDiscount, subtotal);
    const netSubtotal = Math.round(Math.max(0, subtotal - totalDiscount));
    const isTaxActive = settings.taxEnabled !== false && (settings.taxPercent || 0) > 0;
    const taxPercent = isTaxActive ? (settings.taxPercent || 0) : 0;
    const taxAmount = Math.round((netSubtotal * taxPercent) / 100);
    const total = Math.round(netSubtotal + taxAmount);

    // v4.5 TO DO 5.1: jika kasir menutup modal Split di tengah lalu menyimpan Pending / checkout
    // normal dari cart yang sama, lepaskan reserve sesi split (kembalikan sisa belum lunas) agar
    // engine tidak memotong stok penuh di atas reserve yang masih di-hold (double deduction).
    const releasedUnpaid = releaseSplitReserveForCart(cart.items);
    if (releasedUnpaid && Object.keys(releasedUnpaid).length > 0) {
      useInventoryStore
        .getState()
        .revertStock(releasedUnpaid, 'Split Bill (Beralih ke Simpan Pending — Kembalikan Sisa Reserve)');
      addToast('Sesi Split Bill yang belum selesai dibatalkan — sisa stok reserve dikembalikan.', 'info');
    }

    // v4.8 FIX (Bug 2): Ambil versi TERBARU pending dari transactionStore agar kitchenItemStatus
    // yang sudah di-update KDS (done/processing) tidak tertimpa versi stale dari state lokal POS.
    // currentPendingTx bisa stale jika KDS memperbarui status setelah POS me-load pending.
    const freshPendingTx = currentPendingTx
      ? (useTransactionStore.getState().transactions.find((t) => t.id === currentPendingTx.id) ?? currentPendingTx)
      : null;

    // v4.8 TO DO 23.1 & 23.2: merge kitchenItemStatus — pertahankan status item lama, set 'new' untuk item baru
    const cartItemsWithKitchenStatus = freshPendingTx
      ? mergeKitchenItemStatus(cart.items, freshPendingTx.items)
      : cart.items.map((item) => ({ ...item, kitchenItemStatus: 'new' as const }));

    // v4.8.4: hitung deltaKitchenItems saat Simpan Pending jika ada pending sebelumnya
    // agar printer dapur hanya mencetak menu baru / tambahan porsi (bukan semua item)
    const deltaKitchenItems = freshPendingTx
      ? calculateDeltaKitchenItems(cart.items, freshPendingTx.items)
      : undefined;

    const result = await AtomicTransactionEngine.executeCheckout({
      transactionId: currentPendingTx ? currentPendingTx.id : checkoutTxId,
      overrideQueueNumber: currentPendingTx ? currentPendingTx.queueNumber : undefined,
      cartItems: cartItemsWithKitchenStatus,
      subtotal,
      discount: totalDiscount,
      taxAmount,
      totalAmount: total,
      payMethod: 'Cash',
      orderType,
      tableNumber: orderType === 'Dine In' && settings.tableFeaturesEnabled ? tableNumber : undefined,
      selectedCustomerId: selectedCustomerId || undefined,
      selectedCustomerName: selectedCustomer ? selectedCustomer.name : (customCustomerName || undefined),
      currentUser,
      settings,
      overrideTxStatus: 'Pending',
      pendingNotes: 'Pesanan Gantung POS',
      skipReceiptPrint,
      skipKitchenPrint,
      // v4.5 TO DO 5.5: rekam promo/voucher agar total resume konsisten lintas device
      appliedPromoId: appliedPromoId || undefined,
      voucherCode: voucherCode || undefined,
      // v4.7 TO DO 12.2.4 (P-A3): snapshot nama & nominal diskon promo (laporan performa promo)
      promoName: appliedPromo?.name,
      promoAmount: appliedPromoId ? discountCalc.promoApplied : undefined,
      bypassIdempotency: !!currentPendingTx,
      // v4.8 TO DO 23.2: kitchenStatus hanya 'Waiting' jika ADA item dengan status 'new'
      overrideKitchenStatus:
        skipKitchenPrint
          ? (freshPendingTx ? freshPendingTx.kitchenStatus : 'Waiting')
          : (freshPendingTx && !hasNewStatusItems(cartItemsWithKitchenStatus)
              ? freshPendingTx.kitchenStatus
              : 'Waiting'),
      reservedDeductions: currentPendingTx
        ? calculateItemDeductions(currentPendingTx.items, menus)
        : undefined,
      deltaKitchenItems,
    });

    if (result.success) {
      cart.clearCart();
      setShowCheckout(false);
      setDiscountInput('');
      setDiscountType('rp');
      // v4.5 TO DO 5.5: promo tidak boleh bocor ke keranjang berikutnya (clearPromo = id + kode + error)
      clearPromo();
      setCashReceived('');
      setRedeemPointsInput('');
      setSelectedCustomerId(null);
      setCustomCustomerName('');
      setTableNumber('');
      setCheckoutTxId(uuid());
      setCurrentPendingTx(null);
      addToast(`Pesanan #${result.transaction?.queueNumber} berhasil disimpan ke Pesanan Gantung! ⏳`, 'success');
    } else {
      addToast(result.error || 'Gagal menyimpan pesanan gantung!', 'error');
    }
  };

  // Resume Pending Transaction to Cart
  // v4.7 TO DO 20.3: window.confirm → ConfirmDialog (konfirmasi saat keranjang tidak kosong)
  const [resumeConfirmTx, setResumeConfirmTx] = useState<Transaction | null>(null);
  const handleResumePendingOrder = (tx: Transaction) => {
    if (cart.items.length > 0) {
      setResumeConfirmTx(tx);
      return;
    }
    applyResumePendingOrder(tx);
  };
  const applyResumePendingOrder = (tx: Transaction) => {
    cart.clearCart();
    tx.items.forEach((item) => cart.addItem(item));
    setOrderType(tx.orderType || 'Dine In'); // Restore tipe pesanan (Take Away tidak boleh jadi Dine In)
    setTableNumber(tx.tableName || tx.tableNumber || '');
    if (tx.customerId) {
      setSelectedCustomerId(tx.customerId);
      setCustomCustomerName('');
    } else {
      setSelectedCustomerId(null);
      setCustomCustomerName(tx.customerName || '');
    }
    // v4.5 TO DO 5.5: restore promo/voucher yang tersimpan di pending → total yang dihitung ulang
    // konsisten dengan nominal saat disimpan (lintas restart / device). Jika pending tanpa promo,
    // bersihkan promo stale agar tidak bocor ke pesanan yang di-resume.
    if (tx.appliedPromoId) {
      setAppliedPromoId(tx.appliedPromoId);
      setVoucherCode(tx.voucherCode || '');
      setPromoError('');
    } else {
      clearPromo();
    }
    setCurrentPendingTx(tx);
    setCheckoutTxId(tx.id);
    // v4.7 TO DO 17.3: persist identitas pending yang di-resume di cartStore (IndexedDB) —
    // saat POS di-mount ulang (pindah halaman/refresh) state currentPendingTx/checkoutTxId
    // hilang tapi cart tetap ada → tanpa ini finalize memakai UUID baru → transaksi DUPLIKAT.
    useCartStore.getState().setResumeContext({
      id: tx.id,
      queueNumber: tx.queueNumber,
      kitchenStatus: tx.kitchenStatus,
    });
    addToast(`Pesanan gantung #${tx.queueNumber} dimuat ke keranjang.`, 'info');
  };

  // v4.7 TO DO 17.3: restore identitas pending setelah remount (mount ulang POS).
  // Efek ini satu-satunya konsumen resumeContext — setelah restore, currentPendingTx/
  // checkoutTxId kembali seperti sebelum navigasi sehingga semua logika turunan
  // (pendingItemsChanged, parentTx split, status dapur, default skip tiket dapur) konsisten.
  useEffect(() => {
    const cartStore = useCartStore.getState();
    const { tx, stale } = resolveResumeRestore(
      cartStore.resumeContext,
      cartStore.items,
      useTransactionStore.getState().transactions
    );
    // Konteks basi (pending sudah dibayar/dibatalkan di perangkat lain) → bersihkan agar
    // tidak salah dipakai ulang oleh order baru.
    if (stale) cartStore.setResumeContext(null);
    if (!tx) return;
    setCurrentPendingTx(tx);
    setCheckoutTxId(tx.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        .channel('pos-menus-rt-' + Math.random().toString(36).substring(2, 9))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'menus' }, () => {
          useMenuStore.getState().loadFromCloud(true);
        })
        .subscribe();

      invChannel = supabase
        .channel('pos-inventory-rt-' + Math.random().toString(36).substring(2, 9))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => {
          useInventoryStore.getState().loadFromCloud(true);
        })
        .subscribe();

      custChannel = supabase
        .channel('pos-customers-rt-' + Math.random().toString(36).substring(2, 9))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
          useCustomerStore.getState().loadFromCloud(true);
        })
        .subscribe();

      settingsChannel = supabase
        .channel('pos-settings-rt-' + Math.random().toString(36).substring(2, 9))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => {
          useSettingsStore.getState().loadFromCloud();
          usePromoStore.getState().loadFromCloud(true);
          useMenuStore.getState().loadFromCloud(true);
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
    // v4.7 TO DO 15.3: reset opsi cetak ke default tiap modal dibuka — struk selalu ON;
    // tiket dapur default OFF hanya saat finalize resume pending dengan item TIDAK berubah DAN
    // tiket dapur sudah benar-benar tercetak saat Simpan Pending (kitchenTicketPrintedAt) →
    // anti tiket DOBEL. v4.7 TO DO 18.8 (A10): bila tiket belum pernah tercetak (printer gagal
    // saat Simpan Pending), resume TIDAK skip → tiket tidak hilang diam-diam.
    setSkipReceiptPrint(false);
    setSkipKitchenPrint(shouldSkipKitchenPrintAtResume(currentPendingTx, pendingItemsChanged));
    setShowCheckout(true);
  }, [cart.items, menus, inventory, orderType, tableNumber, settings.tableFeaturesEnabled, addToast, currentPendingTx, pendingItemsChanged]);

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
  // v4.7 (TO DO 11 — fitur baru): drag-and-drop urutan badge kategori
  const [dragCat, setDragCat] = useState<string | null>(null);
  const [dropCat, setDropCat] = useState<string | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutTxId, setCheckoutTxId] = useState<string>(() => uuid());

  // Mobile cart toggle
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Customer selection
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customCustomerName, setCustomCustomerName] = useState<string>('');
  // v4.7 shortcut: tambah pelanggan langsung dari keranjang POS (hemat waktu kasir)
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custNotes, setCustNotes] = useState('');

  // Customization state
  const [temp, setTemp] = useState<Temperature>('Dingin');
  const [sugar, setSugar] = useState<SugarLevel>('Normal');
  const [selectedAddons, setSelectedAddons] = useState<AddOn[]>([]);
  const [qty, setQty] = useState(1);

  // Checkout state
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Cash');
  const [cashReceived, setCashReceived] = useState('');
  // v4.7 TO DO 15.3: opsi "cetak tanpa struk" per-transaksi (default: cetak struk kasir)
  const [skipReceiptPrint, setSkipReceiptPrint] = useState(false);
  // v4.7 TO DO 15.3: toggle kedua — tiket dapur. Default OFF saat resume pending dengan item TIDAK
  // berubah (tiket dapur sudah tercetak saat Simpan Pending → anti tiket DOBEL); selain itu default ON.
  const [skipKitchenPrint, setSkipKitchenPrint] = useState(false);
  const [discountInput, setDiscountInput] = useState('');
  const [discountType, setDiscountType] = useState<'rp' | 'percent'>('rp');
  // v4.7 TO DO 22.2: state untuk input diskon per item
  const [editingItemDiscount, setEditingItemDiscount] = useState<string | null>(null);
  const [itemDiscountInput, setItemDiscountInput] = useState('');

  const getManualDiscountValue = useCallback(() => {
    const val = parseInt(discountInput) || 0;
    if (discountType === 'percent') {
      return Math.round((cart.getSubtotal() * val) / 100);
    }
    return val;
  }, [discountInput, discountType, cart]);
  const [stockWarnings, setStockWarnings] = useState<StockWarning[]>([]);
  const [showStockWarning, setShowStockWarning] = useState(false);

  // Promo/Voucher state
  const [voucherCode, setVoucherCode] = useState('');
  const [appliedPromoId, setAppliedPromoId] = useState<string | null>(null);
  const [promoError, setPromoError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  // v4.7 TO DO 12.2.2 (P-A8): poin loyalty yang ingin ditukar pelanggan (diinput kasir)
  const [redeemPointsInput, setRedeemPointsInput] = useState('');

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
  // v4.7 TO DO 12.2.5 (P-A5): delegasi ke helper murni promoDiscount.ts (percentage/fixed/BOGO + minQty)
  const calculatePromoDiscount = useCallback((promoId: string | null, subtotal: number): number => {
    if (!promoId) return 0;
    const promo = activePromos.find((p) => p.id === promoId);
    if (!promo) return 0;
    return calcPromoDiscount(promo, subtotal, { cartItems: cart.items, menus, selectedCustomer });
  }, [activePromos, selectedCustomer, cart.items, menus]);

  const promoDiscount = useMemo(() => calculatePromoDiscount(appliedPromoId, cart.getSubtotal()), [appliedPromoId, cart.items, calculatePromoDiscount]);

  // v4.7 TO DO 12.2.4 (P-A3): snapshot nama promo untuk laporan performa — lookup dari SEMUA promo
  // (bukan hanya active) agar nama tetap terekam walau promo expired/diubah di tengah keranjang.
  const appliedPromo = useMemo(
    () => (appliedPromoId ? promos.find((p) => p.id === appliedPromoId) : undefined),
    [promos, appliedPromoId]
  );

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
    // v4.7 TO DO 12.2.6 (P-A6): promo berbatas per pelanggan wajib ada pelanggan terpilih
    if (promo.usageLimitPerCustomer && promo.usageLimitPerCustomer > 0 && !selectedCustomerId) {
      setPromoError('Voucher ini memiliki batas per pelanggan — pilih pelanggan terlebih dahulu.');
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
    // v4.7 TO DO 12.2.6 (P-A6): promo berbatas per pelanggan wajib ada pelanggan terpilih
    const promo = promos.find((p) => p.id === promoId);
    if (promo?.usageLimitPerCustomer && promo.usageLimitPerCustomer > 0 && !selectedCustomerId) {
      addToast('Pilih pelanggan terlebih dahulu untuk promo dengan batas per pelanggan.', 'warning');
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

  // v4.7 shortcut: tambah pelanggan cepat dari keranjang POS
  const openCustomerForm = () => {
    setCustName('');
    setCustPhone('');
    setCustEmail('');
    setCustNotes('');
    setShowCustomerForm(true);
  };

  const handleSaveNewCustomer = () => {
    if (!custName.trim()) return;
    const newId = uuid();
    addCustomer({
      id: newId,
      name: custName.trim(),
      phone: custPhone.trim(),
      email: custEmail.trim(),
      notes: custNotes.trim(),
      totalSpent: 0,
      visitCount: 0,
      createdAt: new Date().toISOString(),
    });
    if (currentUser) {
      addLog(currentUser.id, currentUser.name, currentUser.role, 'create_customer', `Tambah pelanggan: ${custName.trim()}`, { customerId: newId });
    }
    setSelectedCustomerId(newId);
    setShowCustomerForm(false);
    addToast(`Pelanggan "${custName.trim()}" ditambahkan & dipilih`, 'success');
  };

  // Loyalty discount (auto-applied if customer selected)
  // BUG-M2 fix: added getCustomerDiscount to deps (loyalty settings can change)
  const loyaltyDiscount = useMemo(() => {
    if (!selectedCustomer) return 0;
    const pct = getCustomerDiscount(selectedCustomer.visitCount);
    if (pct <= 0) return 0;
    return Math.round(cart.getSubtotal() * pct / 100);
  }, [selectedCustomer, cart.items, getCustomerDiscount]);

  // v4.7 TO DO 12.2.3 (P-A4): SATU sumber kebenaran total diskon — promo stackable dijumlahkan,
  // promo eksklusif (stackable=false) auto best-deal. Semua call site (finalize, save pending,
  // preview) memakai hasil ini sehingga angka tampil = angka yang dicommit.
  const discountCalc = useMemo(
    () =>
      calculateDiscountBreakdown({
        subtotal: Math.round(cart.getSubtotal()),
        manualDiscount: getManualDiscountValue(),
        promoDiscount,
        loyaltyDiscount,
        promoStackable: appliedPromo?.stackable,
      }),
    [cart, getManualDiscountValue, promoDiscount, loyaltyDiscount, appliedPromo]
  );

  // v4.7 TO DO 12.2.2 (P-A8): redeem poin loyalty — maks dibatasi saldo & headroom diskon
  // (subtotal - diskon lain) agar poin yang ditukar SELALU terpakai penuh (tanpa potongan parsial).
  const availablePoints = selectedCustomer?.loyaltyPoints || 0;
  const maxRedeemPoints = useMemo(() => {
    if (!selectedCustomer || !loyaltySettings.enabled) return 0;
    const headroom = Math.max(0, Math.round(cart.getSubtotal()) - discountCalc.totalDiscount);
    return calculateMaxRedeemablePoints(availablePoints, headroom, loyaltySettings);
  }, [selectedCustomer, loyaltySettings, availablePoints, cart, discountCalc]);
  const redeemPoints = Math.min(parseInt(redeemPointsInput) || 0, maxRedeemPoints);
  const redeemDiscount = useMemo(
    () => calculateRedeemDiscount(redeemPoints, loyaltySettings),
    [redeemPoints, loyaltySettings]
  );
  // Bagian diskon redeem yang benar-benar terpakai (≤ headroom; dengan maxRedeemPoints selalu penuh)
  const redeemApplied = Math.min(redeemDiscount, Math.max(0, Math.round(cart.getSubtotal()) - discountCalc.totalDiscount));

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

  // v4.7 (TO DO 11 — fitur baru): urutan badge kategori mengikuti customCategories (bisa diatur
  // via drag-and-drop), tab sistem 'Semua' & 'Best Seller' tetap di depan.
  const categories = useMemo(
    () => buildCategoryTabs(customCategories, menus.map((m) => m.category)),
    [customCategories, menus]
  );

  // Pindahkan urutan kategori saat drop — hanya kategori asli (bukan tab sistem).
  const handleDropOrder = useCallback(
    (from: string, to: string) => {
      if (from === to) return;
      const realTabs = categories.filter((c) => c !== 'Semua' && c !== 'Best Seller');
      const next = reorderTabs(realTabs, from, to);
      if (next.join('|') !== realTabs.join('|')) reorderCategories(next);
      setDragCat(null);
      setDropCat(null);
    },
    [categories, reorderCategories]
  );

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
      isBundle: selectedMenu.isBundle || false,
    };

    if (selectedMenu.isBundle) {
      item.bundleComponentsSnapshot = buildBundleComponentsSnapshot(selectedMenu, qty, menus, inventory);
      const childItems = createBundleChildCartItems(item, selectedMenu, menus, inventory);
      cart.addBundleItem(item, childItems);
    } else {
      cart.addItem(item);
    }

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
    // v4.7 TO DO 15.3: reset opsi cetak ke default tiap modal dibuka (struk ON; tiket dapur
    // default OFF saat resume pending item tidak berubah & tiket sudah tercetak — anti tiket dobel)
    setSkipReceiptPrint(false);
    setSkipKitchenPrint(shouldSkipKitchenPrintAtResume(currentPendingTx, pendingItemsChanged));
    setShowCheckout(true);
  };

  const finalizeTransaction = async () => {
    if (orderType === 'Dine In' && settings.tableFeaturesEnabled && !tableNumber) {
      addToast('Silakan pilih nomor meja terlebih dahulu!', 'warning');
      return;
    }
    const subtotal = Math.round(cart.getSubtotal());
    // LOGIC-2 & LOGIC-05 fix: Cap total discount to never exceed subtotal & round to whole integer
    // v4.7 TO DO 12.2.3 (P-A4): total diskon dari discount engine (stacking / best-deal promo eksklusif)
    const totalDiscount = discountCalc.totalDiscount;
    const netSubtotal = Math.round(Math.max(0, subtotal - totalDiscount));
    
    // GAP-3 & LOGIC-05 fix: Calculate tax rounded to whole integer Rupiah
    const isTaxActive = settings.taxEnabled !== false && (settings.taxPercent || 0) > 0;
    const taxPercent = isTaxActive ? (settings.taxPercent || 0) : 0;
    const taxAmount = Math.round((netSubtotal * taxPercent) / 100);
    const total = Math.round(netSubtotal + taxAmount);
    const cash = parseInt(cashReceived) || 0;

    // v4.5 TO DO 5.1: jika kasir menutup modal Split di tengah lalu checkout NORMAL dari cart yang
    // sama, lepaskan reserve sesi split (kembalikan sisa belum lunas) agar engine tidak memotong
    // stok penuh di atas reserve yang masih di-hold (double deduction).
    // ⚠️ Residual (dokumentasi): jika sesi split sudah punya sub-bill LUNAS (paid > 0) lalu kasir
    // checkout normal penuh, engine memotong full lagi di atas porsi yang sudah terpakai → porsi
    // yang lunas terpotong dua kali di stok. Ini jalur bisnis ganda (customer dibayar 2x) yang
    // seharusnya dikonfirmasi kasir; di luar lingkup 5.1, didokumentasikan di TO DO.
    const releasedUnpaid = releaseSplitReserveForCart(cart.items);
    if (releasedUnpaid && Object.keys(releasedUnpaid).length > 0) {
      useInventoryStore
        .getState()
        .revertStock(releasedUnpaid, 'Split Bill (Beralih ke Checkout Normal — Kembalikan Sisa Reserve)');
      addToast('Sesi Split Bill yang belum selesai dibatalkan — sisa stok reserve dikembalikan.', 'info');
    }

    // Safety guard: Cash payment must have sufficient funds
    if (payMethod === 'Cash' && cash < total) return;

    // Pre-open print window BEFORE any async calls to avoid popup blocker
    // v4.7 TO DO 15.3: jangan pre-open bila kasir memilih tanpa struk
    let preOpenedPrintWindow: Window | null = null;
    if ((settings.printerEnabled || settings.autoPrintOnCheckout) && settings.printerType !== 'bluetooth' && !skipReceiptPrint) {
      preOpenedPrintWindow = window.open('', '_blank', 'width=400,height=600');
    }

    // v4.7 TO DO 11.2 (P0.4): auto-kirim struk digital — pre-open window WA sebelum await
    // (popup blocker) hanya jika fitur aktif di Settings & pelanggan punya nomor HP valid.
    const autoSendTarget = autoSendReceiptTarget(settings, selectedCustomer);
    let preOpenedWaWindow: Window | null = null;
    if (autoSendTarget) {
      preOpenedWaWindow = window.open('about:blank', '_blank', 'width=480,height=640');
    }

    // v4.8 FIX (Bug 3): Ambil versi TERBARU pending dari store agar kitchenItemStatus yang
    // sudah di-update KDS (done/processing) terbawa ke transaksi final. Tanpa ini, cart.items
    // yang dikirim ke engine tidak memiliki kitchenItemStatus → KDS fallback ke mode legacy
    // dan menampilkan transaksi lunas kembali di kolom Antrean Menunggu.
    const freshPendingForFinalize = currentPendingTx
      ? (useTransactionStore.getState().transactions.find((t) => t.id === currentPendingTx.id) ?? currentPendingTx)
      : null;

    // Merge kitchenItemStatus ke cart items sebelum dikirim ke engine
    const cartItemsForFinalize = freshPendingForFinalize
      ? mergeKitchenItemStatus(cart.items, freshPendingForFinalize.items)
      : cart.items;

    // v4.8 FIX (Bug 3): Hitung kitchenStatus final yang akurat berdasarkan status item aktual.
    // Tidak lagi memaksa 'Waiting' — jika semua item sudah done, set 'Done' agar KDS tidak
    // menampilkan transaksi yang sudah lunas kembali ke Antrean Menunggu.
    const computeFinalKitchenStatus = (items: typeof cartItemsForFinalize): KitchenStatus => {
      const nonBundle = items.filter((i) => !i.isBundle);
      if (nonBundle.length > 0 && nonBundle.every((i) => i.kitchenItemStatus === 'done')) return 'Done';
      if (nonBundle.some((i) => i.kitchenItemStatus === 'processing')) return 'Processing';
      return 'Waiting';
    };

    // v4.7 TO DO 21.1 & v4.8: hitung deltaKitchenItems (hanya item baru/tambahan porsi/spesifikasi baru)
    // agar tiket dapur HANYA mencetak item baru/tambahan (bukan semua item → anti tiket dobel).
    const deltaKitchenItems = freshPendingForFinalize
      ? calculateDeltaKitchenItems(cart.items, freshPendingForFinalize.items)
      : undefined;
    const pendingFinalizeParams: Partial<AtomicCheckoutParams> = currentPendingTx
      ? {
          overrideQueueNumber: currentPendingTx.queueNumber,
          overrideTxStatus: 'Selesai',
          // v4.8 FIX (Bug 3): kitchenStatus dihitung dari status item aktual (freshPendingForFinalize)
          // sehingga transaksi lunas tidak muncul kembali di KDS Antrean Menunggu.
          overrideKitchenStatus: freshPendingForFinalize
            ? computeFinalKitchenStatus(cartItemsForFinalize)
            : 'Waiting',
          bypassIdempotency: true,
          // v4.7 TO DO 21.3: jika SplitBillModal sudah merekonsiliasi stok pending (pendingSplitReconciled),
          // skip reservedDeductions — stok sudah disesuaikan, jangan double-adjust.
          reservedDeductions: pendingSplitReconciled
            ? undefined
            : calculateItemDeductions(currentPendingTx.items, menus),
          deltaKitchenItems,
        }
      : {};

    // Execute Atomic Checkout via AtomicTransactionEngine
    const result = await AtomicTransactionEngine.executeCheckout({
      transactionId: checkoutTxId,
      // v4.8 FIX (Bug 3): pakai cartItemsForFinalize (sudah di-merge dengan kitchenItemStatus terbaru
      // dari KDS) agar transaksi final tidak kehilangan status item → KDS tidak menampilkan order
      // yang sudah lunas kembali di Antrean Menunggu.
      cartItems: cartItemsForFinalize,
      subtotal,
      discount: totalDiscount,
      taxAmount,
      totalAmount: total,
      payMethod,
      cashReceived: cash,
      orderType,
      tableNumber: orderType === 'Dine In' && settings.tableFeaturesEnabled ? tableNumber : undefined,
      selectedCustomerId: selectedCustomerId || undefined,
      selectedCustomerName: selectedCustomer ? selectedCustomer.name : (customCustomerName || undefined),
      currentUser,
      settings,
      preOpenedPrintWindow,
      // v4.7 TO DO 15.3: opsi cetak per-transaksi — dua toggle independen (struk & tiket dapur)
      skipReceiptPrint,
      skipKitchenPrint,
      // v4.5 TO DO 5.5: pertahankan atribusi promo pada tx final (termasuk hasil resume pending)
      // agar laporan promo/transaksi tidak kehilangan metadata yang tersimpan saat save pending.
      appliedPromoId: appliedPromoId || undefined,
      voucherCode: voucherCode || undefined,
      // v4.7 TO DO 12.2.4 (P-A3): snapshot nama & nominal diskon promo (laporan performa promo)
      promoName: appliedPromo?.name,
      promoAmount: appliedPromoId ? discountCalc.promoApplied : undefined,
      ...pendingFinalizeParams,
    });

    if (!result.success) {
      if (preOpenedPrintWindow && !preOpenedPrintWindow.closed) {
        preOpenedPrintWindow.close();
      }
      if (preOpenedWaWindow && !preOpenedWaWindow.closed) {
        preOpenedWaWindow.close();
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

    // v4.7 TO DO 18.8 (E7): efek samping (kunjungan/promo/poin) TIDAK boleh dijalankan ulang
    // saat replay idempoten (double-click / finalize ulang transaksi yang sama) — sebelumnya
    // recordVisit/incrementUsage/deductLoyaltyPoints jalan lagi → kunjungan ganda, pemakaian
    // promo ganda, dan poin loyalty terpotong 2×.
    if (!result.idempotentReplay) {
      // Record customer visit
      if (selectedCustomerId) {
        recordVisit(selectedCustomerId, total);
      }

      // v4.7 TO DO 18.8 (E7): reservePromoUsage — cek batas dari STORE saat commit (bukan salinan
      // render yang bisa stale lintas device) + ledger usageKey tx.id (anti double-increment saat
      // replay transaksi yang sama). Transaksi tetap diproses bila promo habis — hanya peringatan.
      if (appliedPromoId) {
        const usageRes = reservePromoUsage(appliedPromoId, selectedCustomerId || undefined, tx.id);
        if (!usageRes.ok && usageRes.reason === 'limit-reached') {
          addToast('Promo sudah mencapai batas pemakaian — transaksi tetap diproses tanpa menambah pemakaian promo.', 'warning', 6000);
        }
      }

      // v4.7 TO DO 12.2.2 (P-A8): potong poin loyalty yang ditukar (hanya bila benar-benar terpakai —
      // redeemApplied ≥ redeemDiscount karena maxRedeemPoints sudah membatasi headroom)
      if (selectedCustomerId && redeemApplied > 0) {
        deductLoyaltyPoints(selectedCustomerId, Math.floor(redeemApplied / Math.max(1, loyaltySettings.redeemPointsValue || 0)) || 0);
      }
    }

    // Clear cart & reset state with fresh transaction ID for next checkout
    cart.clearCart();
    setShowCheckout(false);
    setSkipReceiptPrint(false);
    setSkipKitchenPrint(false);
    setDiscountInput('');
    setDiscountType('rp');
    setVoucherCode('');
    setCashReceived('');
    setRedeemPointsInput('');
    setSelectedCustomerId(null);
    setCustomCustomerName('');
    setTableNumber('');
    setCheckoutTxId(uuid());
    // v4.7 TO DO 17.3: identity pending TIDAK boleh bocor ke order berikutnya — tanpa ini,
    // setelah finalize resume pending, currentPendingTx tetap menunjuk transaksi yang sudah
    // Selesai → order BARU berikutnya ikut overrideQueueNumber/reservedDeductions lama
    // (stok terpotong salah) dan Simpan Pending bisa memakai ID transaksi lama.
    setCurrentPendingTx(null);

    setPayMethod('Cash');
    clearPromo();
    setOrderType('Dine In');

    // v4.7 TO DO 11.2 (P0.4): isi window WA yang sudah di-pre-open dengan struk lengkap.
    // Hanya untuk transaksi BARU (skip idempotent replay agar tidak mengirim struk ganda).
    if (!result.idempotentReplay && preOpenedWaWindow && !preOpenedWaWindow.closed) {
      const receiptData = buildReceiptFromTransaction(tx, settings);
      const waUrl = buildWhatsAppUrl(autoSendTarget!.phone, buildReceiptText(receiptData));
      if (waUrl) {
        preOpenedWaWindow.location.href = waUrl;
        addToast(`Struk #${tx.queueNumber} dibuka di WhatsApp — tinggal kirim ke pelanggan`, 'success');
      } else {
        preOpenedWaWindow.close();
      }
    }

    addToast(
      result.idempotentReplay
        ? `Transaksi #${tx.queueNumber} sudah diproses sebelumnya.`
        : `Transaksi #${tx.queueNumber} berhasil! 🎉`,
      'success'
    );
  };

  // v4.7 TO DO 18.8 (A13): catat transaksi DEMO langsung dari POS (pelatihan/demo kasir).
  // Demo TIDAK memotong stok, TIDAK mengonsumsi nomor antrean (#DEMO), tidak mencetak
  // struk/tiket dapur, tidak merekam kunjungan/promo/loyalty — murni catatan latihan yang
  // dikecualikan dari laporan. Melengkapi jalur lama (transisi Selesai→Demo di Transactions
  // yang me-revert stok). Bila demo diubah ke Selesai nanti, applyStatusStockEffects
  // men-deduct stok + merekam kunjungan (perilaku 8.1 yang sudah ada).
  const finalizeAsDemo = async () => {
    if (cart.items.length === 0) return;
    if (orderType === 'Dine In' && settings.tableFeaturesEnabled && !tableNumber) {
      addToast('Silakan pilih nomor meja terlebih dahulu!', 'warning');
      return;
    }
    const subtotal = Math.round(cart.getSubtotal());
    const totalDiscount = discountCalc.totalDiscount;
    const netSubtotal = Math.round(Math.max(0, subtotal - totalDiscount));
    const isTaxActive = settings.taxEnabled !== false && (settings.taxPercent || 0) > 0;
    const taxPercent = isTaxActive ? (settings.taxPercent || 0) : 0;
    const taxAmount = Math.round((netSubtotal * taxPercent) / 100);
    const total = Math.round(netSubtotal + taxAmount);

    const result = await AtomicTransactionEngine.executeCheckout({
      transactionId: checkoutTxId,
      cartItems: cart.items,
      subtotal,
      discount: totalDiscount,
      taxAmount,
      totalAmount: total,
      payMethod,
      orderType,
      tableNumber: orderType === 'Dine In' && settings.tableFeaturesEnabled ? tableNumber : undefined,
      selectedCustomerId: selectedCustomerId || undefined,
      selectedCustomerName: selectedCustomer?.name || undefined,
      currentUser,
      settings,
      overrideTxStatus: 'Demo',
      suppressAutoPrint: true, // demo tidak boleh mencetak apa pun (dapur tidak menerima tiket)
    });

    if (!result.success) {
      addToast(result.error || 'Gagal mencatat transaksi demo!', 'error');
      return;
    }

    cart.clearCart();
    setShowCheckout(false);
    setDiscountInput('');
    setDiscountType('rp');
    clearPromo();
    setCashReceived('');
    setRedeemPointsInput('');
    setSelectedCustomerId(null);
    setCustomCustomerName('');
    setTableNumber('');
    setCheckoutTxId(uuid());
    setCurrentPendingTx(null);
    setPayMethod('Cash');
    setOrderType('Dine In');
    addToast(`Transaksi demo #${result.transaction?.queueNumber} dicatat — tidak memotong stok & tidak masuk laporan.`, 'info');
  };

  const isTaxActive = settings.taxEnabled !== false && (settings.taxPercent || 0) > 0;
  const taxPercent = isTaxActive ? (settings.taxPercent || 0) : 0;
  // LOGIC-ERR-02 fix: Use same capping formula as finalizeTransaction()
  // v4.7 TO DO 12.2.3 (P-A4): preview memakai discount engine yang SAMA dengan commit
  const cappedPreviewDiscount = discountCalc.totalDiscount;
  // v4.7 TO DO 12.2.2 (P-A8): preview total ikut memasukkan diskon redeem poin
  // (split bill TIDAK memakai redeem — guna `splitTotalAmount` di bawah, agar tidak ada diskon gratis).
  const previewTotalDiscount = Math.min(cappedPreviewDiscount + redeemDiscount, Math.round(cart.getSubtotal()));
  const netSubtotal = Math.max(0, Math.round(cart.getSubtotal()) - previewTotalDiscount);
  const splitNet = Math.max(0, Math.round(cart.getSubtotal()) - cappedPreviewDiscount);
  const splitTotalAmount = splitNet + Math.round((splitNet * taxPercent) / 100);
  const taxAmount = Math.round((netSubtotal * taxPercent) / 100);
  const finalTotal = netSubtotal + taxAmount;

  return (
    <div className="flex flex-col lg:flex-row gap-0 lg:gap-4 h-full -m-4 lg:-m-6">
      {/* Left: Product Catalog */}
      <div className="flex-1 flex flex-col p-4 lg:p-6 overflow-hidden">
        {/* Search & Filter */}
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari menu..."
                className="input pl-10"
              />
            </div>
            {/* Badge Pesanan Gantung (Pending Payments) */}
            <button
              onClick={() => setShowPendingModal(true)}
              title={
                pendingCount > 0
                  ? `${pendingCount} pesanan gantung menunggu pembayaran`
                  : 'Tidak ada pesanan gantung'
              }
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold border transition whitespace-nowrap ${
                pendingCount > 0
                  ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 shadow-sm'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700/50'
              }`}
            >
              <Clock size={15} />
              <span className="hidden md:inline">Pending</span>
              <span
                className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                  pendingCount > 0
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                }`}
              >
                {pendingCount}
              </span>
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {categories.map((cat) => {
              const isSystemTab = cat === 'Semua' || cat === 'Best Seller';
              const isDragging = dragCat === cat;
              const isDropTarget = dropCat === cat && dragCat && dragCat !== cat;
              return (
                <button
                  key={cat}
                  draggable={!isSystemTab}
                  onDragStart={(e) => {
                    if (isSystemTab) return;
                    setDragCat(cat);
                    setDropCat(null);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', cat); // Firefox butuh setData agar drag dimulai
                  }}
                  onDragOver={(e) => {
                    if (!dragCat || isSystemTab || dragCat === cat) return;
                    e.preventDefault(); // wajib agar onDrop terpicu
                    setDropCat(cat);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragCat && dragCat !== cat) handleDropOrder(dragCat, cat);
                    else {
                      setDragCat(null);
                      setDropCat(null);
                    }
                  }}
                  onDragEnd={() => {
                    setDragCat(null);
                    setDropCat(null);
                  }}
                  onClick={() => setCategory(cat)}
                  title={!isSystemTab ? 'Seret untuk mengatur urutan kategori' : undefined}
                  className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition select-none ${
                    !isSystemTab ? 'cursor-grab active:cursor-grabbing' : ''
                  } ${
                    category === cat
                      ? 'bg-brand-600 text-white'
                      : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                  } ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'ring-2 ring-brand-500 border-brand-400' : ''}`}
                >
                  {cat}
                </button>
              );
            })}
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
          <div className="relative mt-auto bg-white dark:bg-slate-800 rounded-t-2xl max-h-[85vh] flex flex-col shadow-xl animate-in slide-in-from-bottom duration-200">
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
                        : 'hover:bg-red-50 dark:hover:bg-red-950/20 text-red-400 hover:text-red-500'
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

            {/* Customer Selection + shortcut tambah cepat */}
            <div className="px-4 pt-3 space-y-2">
              <div className="flex gap-2">
                <CustomerPicker
                  customers={customers}
                  value={selectedCustomerId}
                  customName={customCustomerName}
                  onSelect={(id) => {
                    setSelectedCustomerId(id);
                    if (id) setCustomCustomerName('');
                  }}
                  onSelectCustom={setCustomCustomerName}
                />
                <button
                  type="button"
                  onClick={openCustomerForm}
                  className="btn-secondary px-3 flex items-center justify-center gap-1 text-xs"
                  title="Tambah Pelanggan Baru"
                >
                  <UserPlus size={16} />
                  <span className="hidden sm:inline">Baru</span>
                </button>
              </div>

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
                      <p className="font-medium text-sm text-slate-800 dark:text-slate-200 truncate">{item.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {item.showTemperature !== false ? item.temperature : ''}{item.showTemperature !== false && item.showSugarLevel !== false ? ' • ' : ''}{item.showSugarLevel !== false ? `Gula ${item.sugar}` : ''}
                        {item.addons.length > 0 && ` • +${item.addons.map((a) => a.name).join(', ')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* v4.7 TO DO 22.2: Tombol diskon per item */}
                      <button
                        onClick={() => {
                          if (editingItemDiscount === item.lineId) {
                            setEditingItemDiscount(null);
                          } else {
                            setEditingItemDiscount(item.lineId);
                            setItemDiscountInput(item.itemDiscount ? String(item.itemDiscount) : '');
                          }
                        }}
                        className={`p-1 transition ${
                          (item.itemDiscount || 0) > 0
                            ? 'text-amber-500 hover:text-amber-600'
                            : editingItemDiscount === item.lineId
                              ? 'text-amber-500'
                              : 'text-slate-400 hover:text-slate-500'
                        }`}
                        title="Diskon item"
                      >
                        <Tag size={14} />
                      </button>
                      <button onClick={() => cart.removeItem(item.lineId)} className="p-1 text-red-400 hover:text-red-500 transition">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {/* Input diskon per item — inline */}
                  {editingItemDiscount === item.lineId && (
                    <div className="flex items-center gap-2 mt-1 mb-2 p-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-900/30">
                      <Tag size={12} className="text-amber-500 shrink-0" />
                      <input
                        type="number"
                        value={itemDiscountInput}
                        onChange={(e) => setItemDiscountInput(e.target.value.replace(/\D/g, ''))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            cart.setItemDiscount(item.lineId, parseInt(itemDiscountInput) || 0);
                            setEditingItemDiscount(null);
                          }
                        }}
                        placeholder="Diskon Rp"
                        className="input text-xs flex-1 h-7"
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          cart.setItemDiscount(item.lineId, parseInt(itemDiscountInput) || 0);
                          setEditingItemDiscount(null);
                        }}
                        className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline"
                      >
                        OK
                      </button>
                      {(item.itemDiscount || 0) > 0 && (
                        <button
                          onClick={() => {
                            cart.setItemDiscount(item.lineId, 0);
                            setEditingItemDiscount(null);
                          }}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Hapus
                        </button>
                      )}
                    </div>
                  )}
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
                    <div className="text-right">
                      {(item.itemDiscount || 0) > 0 && (
                        <p className="text-[10px] text-amber-500 line-through">{formatRupiah((item.basePrice + item.addons.reduce((a, b) => a + b.price, 0)) * item.quantity)}</p>
                      )}
                      <p className="font-semibold text-sm text-brand-700 dark:text-brand-400">{formatRupiah(item.subtotal)}</p>
                    </div>
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
                    <span className="text-green-700 dark:text-green-400 font-medium">✓ {appliedPromo?.name} (-{formatRupiah(discountCalc.promoApplied)})</span>
                    <button onClick={clearPromo} className="text-red-500 hover:underline">Hapus</button>
                  </div>
                )}
                {appliedPromo?.stackable === false && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">ℹ️ Promo eksklusif — otomatis memberi diskon terbaik (promo ATAU manual/loyalty)</p>
                )}
                {promoError && <p className="text-xs text-red-500">{promoError}</p>}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={discountInput}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    if (discountType === 'percent') {
                      const num = parseInt(val) || 0;
                      if (num > 100) return;
                    }
                    setDiscountInput(val);
                  }}
                  placeholder={discountType === 'rp' ? "Diskon manual (Rp)" : "Diskon manual (%)"}
                  className="input text-sm flex-1"
                />
                <div className="flex bg-slate-100 dark:bg-slate-700 p-0.5 rounded-lg text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => {
                      setDiscountType('rp');
                      setDiscountInput('');
                    }}
                    className={`px-2 py-1 rounded-md transition ${
                      discountType === 'rp'
                        ? 'bg-white dark:bg-slate-600 shadow-sm text-slate-800 dark:text-slate-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    Rp
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDiscountType('percent');
                      setDiscountInput('');
                    }}
                    className={`px-2 py-1 rounded-md transition ${
                      discountType === 'percent'
                        ? 'bg-white dark:bg-slate-600 shadow-sm text-slate-800 dark:text-slate-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    %
                  </button>
                </div>
              </div>
              {/* BUG-NEW-06 fix: Show loyalty discount in mobile cart */}
              {/* v4.7 TO DO 12.2.3 (P-A4): hanya tampil bila loyalty benar-benar diterapkan (promo eksklusif bisa mengalahkannya) */}
              {discountCalc.loyaltyApplied > 0 && (
                <div className="p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-lg text-xs text-amber-700 dark:text-amber-400 font-medium">
                  👑 Loyalty discount: -{formatRupiah(discountCalc.loyaltyApplied)}
                </div>
              )}

              {/* v4.7 TO DO 12.2.2 (P-A8): tukar poin loyalty (mobile cart) */}
              {selectedCustomer && loyaltySettings.enabled && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">⭐ Poin {selectedCustomer.name}: {availablePoints}</span>
                    {redeemDiscount > 0 && <span className="text-red-500 dark:text-red-400 font-semibold">-{formatRupiah(redeemDiscount)}</span>}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={redeemPointsInput}
                      onChange={(e) => setRedeemPointsInput(e.target.value.replace(/\D/g, ''))}
                      placeholder={`Tukar poin (maks ${maxRedeemPoints} = ${formatRupiah(calculateRedeemDiscount(maxRedeemPoints, loyaltySettings))})`}
                      className="input text-xs flex-1"
                    />
                    {redeemPoints > 0 && (
                      <button onClick={() => setRedeemPointsInput('')} className="btn-secondary text-xs px-2.5 py-1.5 text-red-500">Batal</button>
                    )}
                  </div>
                  {redeemPointsInput && maxRedeemPoints === 0 && (
                    <p className="text-[10px] text-red-500">Tidak ada poin yang bisa ditukar (saldo 0 / nilai tukar nonaktif).</p>
                  )}
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
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    setMobileCartOpen(false);
                    handleSavePending();
                  }}
                  disabled={cart.items.length === 0}
                  className="btn-secondary flex-1 text-sm py-2.5 flex items-center justify-center gap-1.5"
                  title="Simpan ke pesanan gantung (Pending)"
                >
                  <Clock size={16} />
                  <span>Simpan Pending</span>
                </button>
                <button
                  onClick={() => {
                    setMobileCartOpen(false);
                    handleCheckout();
                  }}
                  className="btn-primary flex-1 text-sm py-2.5 flex items-center justify-center gap-1.5"
                >
                  <CreditCard size={16} />
                  <span>Bayar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="hidden lg:flex w-96 bg-white dark:bg-slate-800 border-l border-slate-100 dark:border-slate-700/50 flex-col">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700/50">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg flex items-center gap-2 text-slate-800 dark:text-slate-200">
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

          {/* Customer Selection - Dropdown + shortcut tambah cepat */}
          <div className="mt-3 flex gap-2">
            <CustomerPicker
              customers={customers}
              value={selectedCustomerId}
              customName={customCustomerName}
              onSelect={(id) => {
                setSelectedCustomerId(id);
                if (id) setCustomCustomerName('');
              }}
              onSelectCustom={setCustomCustomerName}
            />
            <button
              type="button"
              onClick={openCustomerForm}
              className="btn-secondary px-3 flex items-center justify-center gap-1 text-xs"
              title="Tambah Pelanggan Baru"
            >
              <UserPlus size={16} />
              <span className="hidden md:inline">Baru</span>
            </button>
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
              item.isBundleChild ? (
                <div key={item.lineId} className="pl-4 py-1.5 border-l-2 border-brand-400/50 my-1 bg-amber-50/40 dark:bg-slate-900/30 rounded-r-lg flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium flex items-center gap-1.5">
                    <span className="text-brand-500 font-bold">↳</span> {item.quantity}x {item.name} <span className="text-[10px] text-slate-400 font-normal">(Isi Paket)</span>
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 text-slate-500">{item.kitchenTarget === 'ALL' ? 'Semua Dapur' : item.kitchenTarget || 'Dapur'}</span>
                </div>
              ) : (
                <div key={item.lineId} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3">
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-slate-800 dark:text-slate-200 truncate flex items-center gap-1.5">
                        <span>{item.name}</span>
                        {item.isBundle && (
                          <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-[10px] px-1.5 py-0.5">📦 PAKET</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {item.showTemperature !== false ? item.temperature : ''}{item.showTemperature !== false && item.showSugarLevel !== false ? ' • ' : ''}{item.showSugarLevel !== false ? `Gula ${item.sugar}` : ''}
                        {item.addons.length > 0 && ` • +${item.addons.map((a) => a.name).join(', ')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* v4.7 TO DO 22.2: Tombol diskon per item — desktop */}
                      <button
                        onClick={() => {
                          if (editingItemDiscount === item.lineId) {
                            setEditingItemDiscount(null);
                          } else {
                            setEditingItemDiscount(item.lineId);
                            setItemDiscountInput(item.itemDiscount ? String(item.itemDiscount) : '');
                          }
                        }}
                        className={`p-1 transition ${
                          (item.itemDiscount || 0) > 0
                            ? 'text-amber-500 hover:text-amber-600'
                            : editingItemDiscount === item.lineId
                              ? 'text-amber-500'
                              : 'text-slate-400 hover:text-slate-500'
                        }`}
                        title="Diskon item"
                      >
                        <Tag size={14} />
                      </button>
                      <button
                        onClick={() => cart.removeItem(item.lineId)}
                        className="p-1 text-red-400 hover:text-red-500 transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {/* Input diskon per item — inline (desktop) */}
                  {editingItemDiscount === item.lineId && (
                    <div className="flex items-center gap-2 mt-1 mb-2 p-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-900/30">
                      <Tag size={12} className="text-amber-500 shrink-0" />
                      <input
                        type="number"
                        value={itemDiscountInput}
                        onChange={(e) => setItemDiscountInput(e.target.value.replace(/\D/g, ''))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            cart.setItemDiscount(item.lineId, parseInt(itemDiscountInput) || 0);
                            setEditingItemDiscount(null);
                          }
                        }}
                        placeholder="Diskon Rp"
                        className="input text-xs flex-1 h-7"
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          cart.setItemDiscount(item.lineId, parseInt(itemDiscountInput) || 0);
                          setEditingItemDiscount(null);
                        }}
                        className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline"
                      >
                        OK
                      </button>
                      {(item.itemDiscount || 0) > 0 && (
                        <button
                          onClick={() => {
                            cart.setItemDiscount(item.lineId, 0);
                            setEditingItemDiscount(null);
                          }}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Hapus
                        </button>
                      )}
                    </div>
                  )}
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
                    <div className="text-right">
                      {(item.itemDiscount || 0) > 0 && (
                        <p className="text-[10px] text-amber-500 line-through">{formatRupiah((item.basePrice + item.addons.reduce((a, b) => a + b.price, 0)) * item.quantity)}</p>
                      )}
                      <p className="font-semibold text-sm text-brand-700 dark:text-brand-400">{formatRupiah(item.subtotal)}</p>
                    </div>
                  </div>
                </div>
              )
            ))
          )}
        </div>

        {/* Cart Summary Footer */}
        {cart.items.length > 0 && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-700/50 space-y-3 bg-white dark:bg-slate-800">
            {/* Promo Voucher Code */}
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={voucherCode}
                  onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && applyVoucherCode()}
                  placeholder="Kode voucher"
                  className="input text-xs uppercase flex-1 py-1.5"
                />
                {appliedPromoId ? (
                  <button onClick={clearPromo} className="btn-secondary text-xs px-2.5 py-1.5 text-red-500">
                    Batal
                  </button>
                ) : (
                  <button onClick={applyVoucherCode} className="btn-secondary text-xs px-3 py-1.5" disabled={!voucherCode}>
                    Pakai
                  </button>
                )}
              </div>
              {activePromos.length > 0 && !appliedPromoId && (
                <select onChange={(e) => selectPromo(e.target.value)} className="input text-xs w-full py-1.5" value="">
                  <option value="">Pilih promo...</option>
                  {activePromos.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.type === 'percentage' ? `${p.value}%` : formatRupiah(p.value)})</option>
                  ))}
                </select>
              )}
              {appliedPromoId && (
                <p className="text-[11px] text-green-600 dark:text-green-400 font-medium">
                  ✓ Promo berhasil diterapkan (-{formatRupiah(discountCalc.promoApplied)})
                </p>
              )}
              {appliedPromo?.stackable === false && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">ℹ️ Promo eksklusif — otomatis memberi diskon terbaik (promo ATAU manual/loyalty)</p>
              )}
            </div>

            {/* Manual Discount */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={discountInput}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    if (discountType === 'percent') {
                      const num = parseInt(val) || 0;
                      if (num > 100) return;
                    }
                    setDiscountInput(val);
                  }}
                  placeholder={discountType === 'rp' ? "Diskon manual (Rp)" : "Diskon manual (%)"}
                  className="input text-xs flex-1 py-1.5"
                />
                <div className="flex bg-slate-100 dark:bg-slate-700 p-0.5 rounded-lg text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => {
                      setDiscountType('rp');
                      setDiscountInput('');
                    }}
                    className={`px-2 py-1 rounded-md transition ${
                      discountType === 'rp'
                        ? 'bg-white dark:bg-slate-600 shadow-sm text-slate-800 dark:text-slate-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    Rp
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDiscountType('percent');
                      setDiscountInput('');
                    }}
                    className={`px-2 py-1 rounded-md transition ${
                      discountType === 'percent'
                        ? 'bg-white dark:bg-slate-600 shadow-sm text-slate-800 dark:text-slate-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    %
                  </button>
                </div>
              </div>



              {/* Loyalty Discount Banner */}
              {/* v4.7 TO DO 12.2.3 (P-A4): hanya tampil bila loyalty benar-benar diterapkan */}
              {selectedCustomer && discountCalc.loyaltyApplied > 0 && (
                <div className="p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-lg text-xs text-amber-700 dark:text-amber-400 font-medium flex justify-between items-center">
                  <span>👑 Loyalty ({selectedCustomer.name}):</span>
                  <span className="font-bold">-{formatRupiah(discountCalc.loyaltyApplied)}</span>
                </div>
              )}

              {/* v4.7 TO DO 12.2.2 (P-A8): tukar poin loyalty (checkout modal) */}
              {selectedCustomer && loyaltySettings.enabled && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">⭐ Poin {selectedCustomer.name}: {availablePoints}</span>
                    {redeemDiscount > 0 && <span className="text-red-500 dark:text-red-400 font-semibold">-{formatRupiah(redeemDiscount)}</span>}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={redeemPointsInput}
                      onChange={(e) => setRedeemPointsInput(e.target.value.replace(/\D/g, ''))}
                      placeholder={`Tukar poin (maks ${maxRedeemPoints} = ${formatRupiah(calculateRedeemDiscount(maxRedeemPoints, loyaltySettings))})`}
                      className="input text-xs flex-1 py-1.5"
                    />
                    {redeemPoints > 0 && (
                      <button onClick={() => setRedeemPointsInput('')} className="btn-secondary text-xs px-2.5 py-1.5 text-red-500">Batal</button>
                    )}
                  </div>
                  {redeemPointsInput && maxRedeemPoints === 0 && (
                    <p className="text-[10px] text-red-500">Tidak ada poin yang bisa ditukar (saldo 0 / nilai tukar nonaktif).</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-700/50">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Subtotal</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">{formatRupiah(cart.getSubtotal())}</span>
              </div>
              {discountCalc.totalDiscount > 0 && (
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

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleSavePending()}
                  disabled={cart.items.length === 0}
                  className="btn-secondary flex-1 text-sm py-2.5 flex items-center justify-center gap-1.5"
                  title="Simpan ke pesanan gantung (Pending)"
                >
                  <Clock size={16} />
                  <span>Simpan Pending</span>
                </button>
                <button onClick={handleCheckout} className="btn-primary flex-1 text-sm py-2.5 flex items-center justify-center gap-1.5">
                  <CreditCard size={16} />
                  <span>Bayar</span>
                </button>
              </div>
            </div>
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
                        {/* v4.7 revisi 15.1: add-on harga 0 = GRATIS (saus pilihan include) — label jelas, bukan "+Rp 0" */}
                        {addon.price > 0 ? (
                          <span className="text-sm text-brand-600 dark:text-brand-400 font-bold">+{formatRupiah(addon.price)}</span>
                        ) : (
                          <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Gratis</span>
                        )}
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
                  className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center transition"
                >
                  <Minus size={16} />
                </button>
                <span className="text-xl font-bold w-8 text-center text-slate-800 dark:text-slate-200">{qty}</span>
                <button
                  onClick={() => setQty(qty + 1)}
                  className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center transition"
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
            {(selectedCustomer || customCustomerName) && (
              <p className="text-xs text-brand-600 dark:text-brand-400 mt-1">
                Pelanggan: {selectedCustomer ? selectedCustomer.name : `${customCustomerName} (Non-Pelanggan)`}
              </p>
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

          {/* v4.7 TO DO 15.3: opsi cetak per-transaksi — dua toggle independen (struk & tiket dapur)
              TO DO 17.2: berdampingan (row) di desktop, vertikal di mobile */}
          {(settings.printerEnabled || settings.autoPrintOnCheckout) && (
            <div className="flex flex-col gap-1.5 py-1 text-xs text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:gap-6">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!skipReceiptPrint}
                  onChange={(e) => setSkipReceiptPrint(!e.target.checked)}
                  className="accent-brand-600 h-4 w-4"
                />
                <span>Cetak struk kasir</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!skipKitchenPrint}
                  onChange={(e) => setSkipKitchenPrint(!e.target.checked)}
                  className="accent-brand-600 h-4 w-4"
                />
                <span>Cetak tiket dapur</span>
              </label>
              {skipReceiptPrint && skipKitchenPrint && (
                <span className="text-slate-400 dark:text-slate-500 sm:basis-full">(tidak ada cetakan sama sekali)</span>
              )}
            </div>
          )}

          {/* Finalize / Split Bill Action Buttons */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setShowCheckout(false);
                setShowSplitModal(true);
              }}
              className="btn-secondary flex-1 text-sm py-2.5 flex items-center justify-center gap-1.5"
              title="Pisahkan Pembayaran (Split Bill)"
            >
              <Scissors size={16} />
              <span>Split Bill</span>
            </button>
            <button
              onClick={finalizeTransaction}
              disabled={
                payMethod === 'Cash' &&
                (!cashReceived || (parseInt(cashReceived) || 0) < finalTotal)
              }
              className="btn-primary flex-1 text-base py-2.5"
            >
              Selesaikan Pesanan
            </button>
          </div>

          {/* v4.7 TO DO 18.8 (A13): jalur pembuatan transaksi DEMO — pelatihan/demo kasir
              tanpa memotong stok, tanpa nomor antrean, tanpa cetak & tanpa masuk laporan.
              Hanya untuk keranjang BARU: saat resume pending (currentPendingTx) stok sudah
              dipotong saat Simpan Pending — mengubahnya jadi Demo akan membocorkan deduksi itu. */}
          {!currentPendingTx && (
            <button
              type="button"
              onClick={finalizeAsDemo}
              className="w-full text-xs py-1.5 flex items-center justify-center gap-1.5 text-purple-600 dark:text-purple-400 border border-dashed border-purple-300 dark:border-purple-800/60 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-950/30 transition"
              title="Catat sebagai transaksi DEMO (pelatihan) — tidak memotong stok, tidak mengonsumsi nomor antrean, tidak dicetak, dikecualikan dari laporan"
            >
              <FlaskConical size={14} />
              <span>Catat sebagai Demo (tidak memotong stok)</span>
            </button>
          )}
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
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Beberapa bahan baku tidak mencukupi untuk pesanan ini:
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {stockWarnings.map((w) => (
              <div key={w.ingredientId} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl">
                <div>
                  {/* v4.7 TO DO 18.8 (A11): bahan yang direferensikan resep sudah dihapus dari
                      inventory — tampilkan peringatan eksplisit (bukan hanya id mentah). */}
                  {w.missing ? (
                    <p className="font-medium text-sm text-red-800 dark:text-red-300">
                      Bahan tidak ditemukan (ID: {w.ingredientId})
                    </p>
                  ) : (
                    <p className="font-medium text-sm text-red-800 dark:text-red-300">{w.ingredientName}</p>
                  )}
                  <p className="text-xs text-red-500 dark:text-red-400">
                    {w.missing
                      ? `Resep memakai bahan ini (${w.required.toFixed(2)}) tapi bahan sudah dihapus dari Inventaris — stok tidak bisa diverifikasi.`
                      : `Butuh: ${w.required.toFixed(2)} ${w.unit} • Tersedia: ${w.available.toFixed(2)} ${w.unit}`}
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

      {/* v4.7 shortcut: modal tambah pelanggan cepat dari keranjang */}
      <Modal
        open={showCustomerForm}
        onClose={() => setShowCustomerForm(false)}
        title="Tambah Pelanggan Baru"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div>
            <label className="label">Nama *</label>
            <input
              value={custName}
              onChange={(e) => setCustName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveNewCustomer()}
              className="input"
              placeholder="Nama pelanggan"
              autoFocus
            />
          </div>
          <div>
            <label className="label">No. Telepon (WhatsApp)</label>
            <input
              value={custPhone}
              onChange={(e) => setCustPhone(e.target.value)}
              className="input"
              placeholder="08xxxxxxxxxx"
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              value={custEmail}
              onChange={(e) => setCustEmail(e.target.value)}
              className="input"
              type="email"
            />
          </div>
          <div>
            <label className="label">Catatan</label>
            <textarea
              value={custNotes}
              onChange={(e) => setCustNotes(e.target.value)}
              className="input"
              rows={2}
            />
          </div>
          <div className="flex gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button onClick={() => setShowCustomerForm(false)} className="btn-secondary flex-1">Batal</button>
            <button onClick={handleSaveNewCustomer} className="btn-primary flex-1" disabled={!custName.trim()}>
              Tambah & Pilih
            </button>
          </div>
        </div>
      </Modal>

      {/* Pending Payments Modal */}
      <PendingPaymentsModal
        open={showPendingModal}
        onClose={() => setShowPendingModal(false)}
        onResumeOrder={handleResumePendingOrder}
      />

      {/* Split Bill Modal */}
      <SplitBillModal
        open={showSplitModal}
        onClose={() => setShowSplitModal(false)}
        cartItems={cart.items}
        subtotal={cart.getSubtotal()}
        discount={cappedPreviewDiscount}
        taxAmount={taxAmount}
        // v4.7 TO DO 12.2.2 (P-A8): split bill memakai total TANPA redeem poin (poin hanya
        // terpotong saat finalize; sub-bill yang membawa diskon redeem tanpa potong poin = diskon gratis)
        totalAmount={splitTotalAmount}
        orderType={orderType}
        tableNumber={tableNumber}
        parentTx={currentPendingTx}
        selectedCustomerId={selectedCustomerId}
        selectedCustomerName={selectedCustomer ? selectedCustomer.name : (customCustomerName || undefined)}
        appliedPromoId={appliedPromoId}
        onCompleteSplit={() => {
          cart.clearCart();
          setShowCheckout(false);
          setDiscountInput('');
          setDiscountType('rp');
          setVoucherCode('');
          setCashReceived('');
          setSelectedCustomerId(null);
          setCustomCustomerName('');
          setTableNumber('');
          setCheckoutTxId(uuid());
          setCurrentPendingTx(null);
          setPendingSplitReconciled(false);
        }}
        // v4.7 TO DO 21.3: callback saat SplitBillModal merekonsiliasi stok pending —
        // POS.tsx skip reservedDeductions di finalisasi (anti double-adjust).
        onReconcile={() => setPendingSplitReconciled(true)}
      />

      {/* v4.7 TO DO 20.3: konfirmasi resume pending saat keranjang berisi (bukan window.confirm) */}
      <ConfirmDialog
        open={!!resumeConfirmTx}
        onClose={() => setResumeConfirmTx(null)}
        onConfirm={() => {
          if (resumeConfirmTx) applyResumePendingOrder(resumeConfirmTx);
        }}
        title="Muat Pesanan Gantung"
        message={`Keranjang saat ini berisi ${cart.items.length} item. Kosongkan keranjang & muat pesanan gantung #${resumeConfirmTx?.queueNumber ?? ''}?`}
        confirmText="Ya, Muat"
        variant="warning"
      />

      {/* Modal Opsi Cetak Pesanan Pending (jika pendingPrintOption === 'ask') */}
      <Modal
        open={showPendingPrintModal}
        onClose={() => setShowPendingPrintModal(false)}
        title="🖨️ Opsi Cetak Pesanan Pending"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Pilih jenis pencetakan struk/tiket untuk pesanan gantung ini:
          </p>

          <div className="grid grid-cols-1 gap-2.5">
            <button
              onClick={() => {
                setShowPendingPrintModal(false);
                handleSavePending({ skipReceiptPrint: true, skipKitchenPrint: false });
              }}
              className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 text-left transition flex items-start gap-3 group"
            >
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 mt-0.5">
                <UtensilsCrossed size={18} />
              </div>
              <div>
                <div className="font-semibold text-sm text-slate-800 dark:text-slate-200 group-hover:text-amber-700 dark:group-hover:text-amber-300">
                  Cetak Struk (Dapur) Saja
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Mencetak tiket pesanan ke printer dapur/bar. Struk kasir dilewati.
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                setShowPendingPrintModal(false);
                handleSavePending({ skipReceiptPrint: false, skipKitchenPrint: false });
              }}
              className="p-3.5 rounded-xl border border-brand-200 dark:border-brand-800/60 bg-brand-50/50 dark:bg-brand-950/20 hover:bg-brand-100/60 dark:hover:bg-brand-900/40 text-left transition flex items-start gap-3 group"
            >
              <div className="p-2 rounded-lg bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-300 mt-0.5">
                <Printer size={18} />
              </div>
              <div>
                <div className="font-semibold text-sm text-slate-800 dark:text-slate-200 group-hover:text-brand-700 dark:group-hover:text-brand-300">
                  Cetak Struk Sekarang (Kasir & Dapur)
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Mencetak Struk Kasir untuk konsumen dan tiket pesanan ke printer dapur.
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                setShowPendingPrintModal(false);
                handleSavePending({ skipReceiptPrint: true, skipKitchenPrint: true });
              }}
              className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition flex items-start gap-3 group"
            >
              <div className="p-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 mt-0.5">
                <X size={18} />
              </div>
              <div>
                <div className="font-semibold text-sm text-slate-800 dark:text-slate-200">
                  Simpan Tanpa Cetak
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Simpan ke daftar Pesanan Gantung tanpa mencetak struk atau tiket dapur.
                </div>
              </div>
            </button>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={() => setShowPendingPrintModal(false)}
              className="btn-secondary text-sm"
            >
              Batal
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
