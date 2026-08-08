import { useState, useMemo, useRef, useEffect } from 'react';
import Modal from './Modal';
import { formatRupiah } from '../utils/format';
import type { CartItem, PaymentMethod, Transaction, AppSettings, OrderType } from '../types';
import { AtomicTransactionEngine } from '../lib/atomicTransactionEngine';
import { InventoryEngine } from '../lib/inventoryEngine';
import { createSnapshotForCartItems } from '../utils/hpp';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';
import { useTransactionStore } from '../store/transactionStore';
import { useInventoryStore } from '../store/inventoryStore';
import { useMenuStore } from '../store/menuStore';
import { useCustomerStore } from '../store/customerStore';
import { usePromoStore } from '../store/promoStore';
import { printSplitReceipt } from '../utils/printer';
import { allocateProportional } from '../utils/splitAllocation';
import { Scissors, Users, ShoppingBag, CheckCircle, CreditCard, Banknote, QrCode, ArrowRight } from 'lucide-react';

interface SplitBillModalProps {
  open: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  subtotal: number;
  discount: number;
  taxAmount: number;
  totalAmount: number;
  orderType: OrderType;
  tableNumber?: string;
  parentTx?: Transaction | null;
  selectedCustomerId?: string | null;
  selectedCustomerName?: string | null;
  appliedPromoId?: string | null;
  onCompleteSplit: () => void;
}

type SplitMode = 'equal' | 'item';

interface SubBillDraft {
  id: number;
  items: CartItem[];
  totalAmount: number;
  subtotal: number;
  discount: number;
  tax: number;
  payMethod: PaymentMethod;
  cashReceived: string;
  isPaid: boolean;
  paidTx?: Transaction;
}

export default function SplitBillModal({
  open,
  onClose,
  cartItems,
  subtotal,
  discount,
  taxAmount,
  totalAmount,
  orderType,
  tableNumber,
  parentTx,
  selectedCustomerId,
  selectedCustomerName,
  appliedPromoId,
  onCompleteSplit,
}: SplitBillModalProps) {
  const { settings } = useSettingsStore();
  const { currentUser } = useAuthStore();
  const { addToast } = useToastStore();
  const { updateTxStatus, updateTxMeta } = useTransactionStore();
  const { items: inventory } = useInventoryStore();
  const { menus } = useMenuStore();
  const { recordVisit } = useCustomerStore();
  const { incrementUsage } = usePromoStore();

  // v4.1 TO DO 1.5 — Manajemen stok split bill:
  // - Fresh split (tanpa parentTx): stok dipotong SEKALI untuk seluruh item cart saat sub-bill pertama dibayar.
  //   Sub-bill berikutnya mengirim reservedDeductions = deduksi item sub-bill itu sendiri → engine menghitung delta 0
  //   sehingga stok tidak terpotong dua kali. Sisa stok yang belum lunas dikembalikan saat modal ditutup.
  // - Split pending (parentTx ada): stok sudah dipotong saat pending dibuat → reservedDeductions per sub-bill (delta 0).
  const sessionReservedRef = useRef<Record<string, number> | null>(null);
  const sessionPaidRef = useRef<Record<string, number>>({});
  // v4.1 TO DO 2.8: flag terpisah — catat visit/promo HANYA sekali per sesi split.
  // (Jangan di-derive dari sessionPaidRef: sub-bill bisa lunas TANPA deduksi bahan baku,
  // sehingga map deductions tetap kosong dan kondisi berbasis isi map bisa double-fire.)
  const sessionVisitRecordedRef = useRef(false);

  // v4.1 TO DO 1.5: Reset state stok sesi setiap kali modal dibuka — mencegah ref stale
  // dari sesi split sebelumnya (modal tetap ter-mount, open hanya di-toggle).
  useEffect(() => {
    if (open) {
      sessionReservedRef.current = null;
      sessionPaidRef.current = {};
      sessionVisitRecordedRef.current = false;
    }
  }, [open]);

  const computeDeductions = (items: CartItem[]): Record<string, number> => {
    try {
      const { itemsWithSnapshot } = createSnapshotForCartItems(items, menus, inventory);
      return InventoryEngine.computeDeductions(itemsWithSnapshot, menus);
    } catch (e) {
      console.warn('[SplitBillModal] Gagal menghitung deduksi stok:', e);
      return {};
    }
  };

  const handleClose = () => {
    // Fresh split: jika modal ditutup sebelum semua sub-bill lunas, kembalikan stok item yang belum dibayar
    if (sessionReservedRef.current) {
      const remaining: Record<string, number> = {};
      for (const [invId, fullQty] of Object.entries(sessionReservedRef.current)) {
        const diff = fullQty - (sessionPaidRef.current[invId] || 0);
        if (diff > 0) remaining[invId] = diff;
      }
      if (Object.keys(remaining).length > 0) {
        useInventoryStore.getState().revertStock(remaining, 'Split Bill (Dibatalkan — Kembalikan Stok Belum Lunas)');
      }
      sessionReservedRef.current = null;
      sessionPaidRef.current = {};
    }
    onClose();
  };

  // v4.1 TO DO 2.8: Finalisasi parent pending — status 'Selesai' + paymentMethod MAYORITAS
  // (dari total nominal sub-bill yang lunas), agar laporan distribusi pembayaran tidak selalu
  // 'Cash' walau dibayar QRIS/Transfer.
  const finalizeSplitParent = (
    currentPaidState: Record<number, { isPaid: boolean; tx?: Transaction; payMethod: PaymentMethod; cash: string }>
  ) => {
    if (!parentTx?.id) return;
    const methodTotals: Record<string, number> = {};
    Object.values(currentPaidState).forEach((st) => {
      if (st?.tx) {
        methodTotals[st.payMethod] = (methodTotals[st.payMethod] || 0) + st.tx.totalAmount;
      }
    });
    const mainMethod =
      (Object.entries(methodTotals).sort((a, b) => b[1] - a[1])[0]?.[0] as PaymentMethod) || 'Cash';
    updateTxMeta(parentTx.id, { paymentMethod: mainMethod });
    updateTxStatus(parentTx.id, 'Selesai');
  };

  const [mode, setMode] = useState<SplitMode>('equal');
  const [equalCount, setEqualCount] = useState<number>(2);
  const [activeBillIdx, setActiveBillIdx] = useState<number>(0);
  const [itemAssignments, setItemAssignments] = useState<Record<string, number>>({}); // lineId -> subBillIndex (0, 1, 2)
  const [billCountCustom, setBillCountCustom] = useState<number>(2);

  // Sub-bills for Equal Mode
  const equalBills = useMemo<SubBillDraft[]>(() => {
    if (equalCount <= 1) return [];
    // v4.1 TO DO 2.2 — SEMUA komponen dialokasikan dengan Largest Remainder Method:
    // Σ subtotal, Σ diskon, Σ pajak, dan Σ total 100% klop dengan transaksi induk
    // (tanpa selisih Math.round per sub-bill). totalAmount dihitung dari komponen
    // yang sudah klop → Σ totalAmount_i = total induk secara otomatis.
    const equalRatios = Array(equalCount).fill(1 / equalCount);
    const allocatedSubtotal = allocateProportional(subtotal, equalRatios);
    const allocatedDiscount = allocateProportional(discount, equalRatios);
    const allocatedTax = allocateProportional(taxAmount, equalRatios);

    return Array.from({ length: equalCount }).map((_, idx) => {
      const s = allocatedSubtotal[idx];
      const d = allocatedDiscount[idx];
      const t = allocatedTax[idx];
      return {
        id: idx,
        items: cartItems, // All items shared conceptually
        subtotal: s,
        discount: d,
        tax: t,
        totalAmount: Math.max(0, s - d + t),
        payMethod: 'Cash',
        cashReceived: '',
        isPaid: false,
      };
    });
    // totalAmount tidak di deps: ia turunan deterministik dari subtotal/discount/taxAmount
    // (finalTotal POS = subtotal - discount + taxAmount, semuanya integer).
  }, [subtotal, discount, taxAmount, equalCount, cartItems]);

  // Sub-bills for Item Mode
  const itemBills = useMemo<SubBillDraft[]>(() => {
    const bills: SubBillDraft[] = Array.from({ length: billCountCustom }).map((_, idx) => ({
      id: idx,
      items: [],
      subtotal: 0,
      discount: 0,
      tax: 0,
      totalAmount: 0,
      payMethod: 'Cash',
      cashReceived: '',
      isPaid: false,
    }));

    // Group items into assigned bills
    cartItems.forEach((item) => {
      const targetBillIdx = itemAssignments[item.lineId] || 0;
      const safeIdx = Math.min(targetBillIdx, billCountCustom - 1);
      bills[safeIdx].items.push(item);
      bills[safeIdx].subtotal += item.subtotal;
    });

    // v4.1 TO DO 2.2 — Alokasi diskon & pajak proporsional dengan Largest Remainder Method
    // (Σ discount_i === discount, Σ tax_i === taxAmount — tidak ada selisih pembulatan).
    const ratios = bills.map((b) => (subtotal > 0 ? b.subtotal / subtotal : 0));
    const allocatedDiscount = allocateProportional(discount, ratios);
    const allocatedTax = allocateProportional(taxAmount, ratios);
    bills.forEach((b, i) => {
      b.discount = allocatedDiscount[i];
      b.tax = allocatedTax[i];
      b.totalAmount = Math.max(0, b.subtotal - b.discount + b.tax);
    });

    return bills;
  }, [billCountCustom, cartItems, itemAssignments, subtotal, discount, taxAmount]);

  // Active list of sub-bills depending on selected mode
  const [paidState, setPaidState] = useState<Record<number, { isPaid: boolean; tx?: Transaction; payMethod: PaymentMethod; cash: string }>>({});

  const activeBills = mode === 'equal' ? equalBills : itemBills;

  const handlePaySubBill = async (billIdx: number) => {
    const targetBill = activeBills[billIdx];
    if (!targetBill) return;

    // v4.1: Sub-bill tanpa item (totalAmount 0) tidak perlu diproses ke engine
    // (guard 'Keranjang kosong' di AtomicEngine akan menolaknya) — auto-tandai lunas agar alur split tidak terkunci.
    if (targetBill.items.length === 0) {
      const nextPaidState = {
        ...paidState,
        [billIdx]: { isPaid: true, payMethod: 'Cash' as PaymentMethod, cash: '' },
      };
      setPaidState(nextPaidState);
      addToast(`Sub-Bill ${billIdx + 1} tidak memiliki item — dilewati.`, 'info');

      const allPaid = activeBills.every((_, idx) => idx === billIdx || nextPaidState[idx]?.isPaid);
      if (allPaid) {
        finalizeSplitParent(nextPaidState);
        addToast('Seluruh Split Bill berhasil dilunasi! 🎉', 'success');
        onCompleteSplit();
        handleClose(); // via handleClose agar refs stok sesi ikut di-reset
      } else {
        const nextUnpaid = activeBills.findIndex((_, idx) => !nextPaidState[idx]?.isPaid);
        if (nextUnpaid !== -1) setActiveBillIdx(nextUnpaid);
      }
      return;
    }

    const currentPayState = paidState[billIdx] || { payMethod: 'Cash', cash: '' };
    const payMethod = currentPayState.payMethod || 'Cash';
    const cash = parseInt(currentPayState.cash) || 0;

    if (payMethod === 'Cash' && cash < targetBill.totalAmount) {
      addToast('Jumlah uang tunai kurang dari nominal tagihan!', 'warning');
      return;
    }

    // Pre-open print window if needed
    let preOpenedPrintWindow: Window | null = null;
    if ((settings.printerEnabled || settings.autoPrintOnCheckout) && settings.printerType !== 'bluetooth') {
      preOpenedPrintWindow = window.open('', '_blank', 'width=400,height=600');
    }

    // v4.1 TO DO 1.5 — Stok split bill:
    // Fresh split: validasi SELURUH cart dulu (sebelum sub-bill mana pun dibayar), lalu stok penuh
    // dipotong SEKALI SETELAH commit sub-bill pertama sukses (reserve). Sub-bill berikutnya mengirim
    // reservedDeductions = deduksi item sub-bill itu sendiri → engine menghitung delta 0 (tidak potong 2x).
    // Pending split: stok sudah dipotong saat pending dibuat — cukup reservedDeductions per sub-bill (delta 0).
    if (!parentTx && !sessionReservedRef.current) {
      const fullValidation = InventoryEngine.validateStockAvailability(cartItems, menus, inventory);
      if (!fullValidation.valid) {
        addToast(
          fullValidation.warnings && fullValidation.warnings.length > 0
            ? `Stok tidak cukup untuk split bill: ${fullValidation.warnings.map((w) => w.ingredientName).join(', ')}`
            : 'Stok bahan baku tidak mencukupi untuk split bill.',
          'error'
        );
        return;
      }
    }
    const reservedForSubBill = computeDeductions(targetBill.items);

    // Execute atomic checkout for this Sub-Bill
    const result = await AtomicTransactionEngine.executeCheckout({
      cartItems: targetBill.items,
      subtotal: targetBill.subtotal,
      discount: targetBill.discount,
      taxAmount: targetBill.tax,
      totalAmount: targetBill.totalAmount,
      payMethod,
      cashReceived: cash,
      orderType,
      tableNumber,
      currentUser,
      settings,
      preOpenedPrintWindow,

      // v4.1 TO DO 1.5: reservedDeductions = deduksi item sub-bill itu sendiri → delta 0 (stok tidak dipotong 2x).
      // suppressAutoPrint: modal yang mengelola cetak struk & tiket dapur (engine auto-print dimatikan).
      reservedDeductions: reservedForSubBill,
      suppressAutoPrint: true,
      overrideTxStatus: 'Selesai',
      splitParentId: parentTx?.id,
      splitIndex: billIdx + 1,
      totalSplitCount: activeBills.length,
      // v4.1 TO DO 2.8: rekam customer terpilih ke setiap sub-bill (CRM & laporan per-customer akurat)
      selectedCustomerId: selectedCustomerId || undefined,
      selectedCustomerName: selectedCustomerName || undefined,
    });

    if (!result.success) {
      if (preOpenedPrintWindow && !preOpenedPrintWindow.closed) preOpenedPrintWindow.close();
      addToast(result.error || 'Gagal memproses pembayaran sub-bill!', 'error');
      return;
    }

    const subTx = result.transaction!;

    // v4.1 TO DO 1.5: Reserve stok penuh HANYA pada sub-bill pertama yang BERHASIL di split fresh
    // (dihitung setelah commit sukses — jika attempt pertama gagal, retry tetap dianggap sub-bill pertama).
    const isFirstSuccessfulPayment = !parentTx && !sessionReservedRef.current;
    if (isFirstSuccessfulPayment) {
      const fullDeductions = computeDeductions(cartItems);
      useInventoryStore.getState().deductStock(fullDeductions, 'Split Bill (Reserve Stok Semua Item)');
      sessionReservedRef.current = fullDeductions;
    }

    // v4.1 TO DO 2.8: rekam kunjungan customer & usage promo SEKALI pada sub-bill pertama yang lunas
    // (paralel dengan finalizeTransaction di checkout normal — split tidak boleh melewatkannya).
    if (!sessionVisitRecordedRef.current) {
      sessionVisitRecordedRef.current = true;
      if (selectedCustomerId) {
        recordVisit(selectedCustomerId, totalAmount);
      }
      if (appliedPromoId) {
        incrementUsage(appliedPromoId);
      }
    }

    // Akumulasi stok sub-bill yang sudah lunas (dipakai untuk revert sisa stok
    // saat modal ditutup sebelum semua sub-bill dibayar).
    for (const [invId, qty] of Object.entries(reservedForSubBill)) {
      sessionPaidRef.current[invId] = (sessionPaidRef.current[invId] || 0) + qty;
    }

    // Cetak struk sub-bill. Saat split fresh sub-bill pertama, cetak juga tiket dapur LENGKAP sekali
    // (dapur belum pernah menerima tiket). Split pending tidak mencetak ulang tiket (sudah saat pending dibuat).
    if (settings.printerEnabled || settings.autoPrintOnCheckout) {
      if (isFirstSuccessfulPayment) {
        printSplitReceipt(subTx, null, settings, 'all', cartItems).catch(() => {});
      } else {
        printSplitReceipt(subTx, parentTx, settings, 'cashier').catch(() => {});
      }
    }

    const nextPaidState = {
      ...paidState,
      [billIdx]: { isPaid: true, tx: subTx, payMethod, cash: String(cash) },
    };
    setPaidState(nextPaidState);

    addToast(`Sub-Bill ${billIdx + 1}/${activeBills.length} Lunas! 🎉`, 'success');

    // Check if ALL sub-bills are now paid
    const allPaid = activeBills.every((_, idx) => idx === billIdx || nextPaidState[idx]?.isPaid);
    if (allPaid) {
      finalizeSplitParent(nextPaidState);
      addToast(`Seluruh Split Bill berhasil dilunasi! 🎉`, 'success');
      onCompleteSplit();
      handleClose(); // via handleClose agar refs stok sesi ikut di-reset
    } else {
      // Move to next unpaid bill
      const nextUnpaid = activeBills.findIndex((_, idx) => !nextPaidState[idx]?.isPaid);
      if (nextUnpaid !== -1) setActiveBillIdx(nextUnpaid);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="✂️ Split Bill (Pisah Pembayaran)" maxWidth="max-w-3xl">
      <div className="space-y-4">
        {/* Mode Selector */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
          <button
            onClick={() => setMode('equal')}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
              mode === 'equal'
                ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-brand-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Users size={16} /> Split Nominal Rata (Equal)
          </button>
          <button
            onClick={() => setMode('item')}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
              mode === 'item'
                ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-brand-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <ShoppingBag size={16} /> Split Per-Item (Custom)
          </button>
        </div>

        {/* Mode Config */}
        {mode === 'equal' ? (
          <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 p-3 rounded-xl border border-blue-100 dark:border-blue-900/50">
            <span className="text-xs font-semibold text-blue-900 dark:text-blue-200">
              Bagi Tagihan Rp {formatRupiah(totalAmount)} Menjadi:
            </span>
            <div className="flex items-center gap-2">
              {[2, 3, 4, 5].map((cnt) => (
                <button
                  key={cnt}
                  onClick={() => { setEqualCount(cnt); setActiveBillIdx(0); }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    equalCount === cnt
                      ? 'bg-brand-600 text-white'
                      : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {cnt} Orang
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Jumlah Tagihan Terpisah (Sub-Bill):
              </span>
              <div className="flex gap-1">
                {[2, 3, 4].map((cnt) => (
                  <button
                    key={cnt}
                    onClick={() => { setBillCountCustom(cnt); setActiveBillIdx(0); }}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition ${
                      billCountCustom === cnt
                        ? 'bg-brand-600 text-white'
                        : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600'
                    }`}
                  >
                    {cnt} Bill
                  </button>
                ))}
              </div>
            </div>

            {/* Item Allocation Table */}
            <div className="max-h-40 overflow-y-auto space-y-1.5 text-xs">
              {cartItems.map((item) => {
                const assignedIdx = itemAssignments[item.lineId] || 0;
                return (
                  <div key={item.lineId} className="flex items-center justify-between bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                    <span className="font-medium truncate max-w-[180px]">{item.name} x{item.quantity}</span>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: billCountCustom }).map((_, bIdx) => (
                        <button
                          key={bIdx}
                          onClick={() => setItemAssignments({ ...itemAssignments, [item.lineId]: bIdx })}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                            assignedIdx === bIdx
                              ? 'bg-brand-600 text-white'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                          }`}
                        >
                          Bill {bIdx + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Sub-Bills Progress Tabs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {activeBills.map((bill, idx) => {
            const isPaid = paidState[idx]?.isPaid;
            const isActive = activeBillIdx === idx;

            return (
              <button
                key={idx}
                onClick={() => setActiveBillIdx(idx)}
                className={`p-2.5 rounded-xl border text-left transition relative ${
                  isPaid
                    ? 'bg-green-50 border-green-300 dark:bg-green-950/40 dark:border-green-800'
                    : isActive
                    ? 'bg-brand-50 border-brand-500 dark:bg-brand-950/40'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Sub-Bill {idx + 1}
                  </span>
                  {isPaid ? (
                    <CheckCircle className="text-green-600" size={14} />
                  ) : (
                    <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded">
                      Belum
                    </span>
                  )}
                </div>
                <p className="font-bold text-xs text-brand-600 dark:text-brand-400">
                  {formatRupiah(bill.totalAmount)}
                </p>
              </button>
            );
          })}
        </div>

        {/* Active Sub-Bill Payment Box */}
        {activeBills[activeBillIdx] && (
          <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl space-y-3 border border-slate-200 dark:border-slate-700">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-700">
              <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Pembayaran Sub-Bill {activeBillIdx + 1} dari {activeBills.length}
              </h4>
              <span className="font-bold text-base text-brand-600 dark:text-brand-400">
                {formatRupiah(activeBills[activeBillIdx].totalAmount)}
              </span>
            </div>

            {paidState[activeBillIdx]?.isPaid ? (
              <div className="text-center py-4 bg-green-100 dark:bg-green-950/60 rounded-xl text-green-800 dark:text-green-200 text-xs font-semibold">
                ✓ Sub-Bill ini sudah LUNAS
              </div>
            ) : (
              <div className="space-y-3">
                {/* Method selector */}
                <div>
                  <label className="label text-xs mb-1">Metode Pembayaran Sub-Bill</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { type: 'Cash', icon: Banknote, label: 'Tunai' },
                      { type: 'QRIS', icon: QrCode, label: 'QRIS' },
                      { type: 'Transfer', icon: CreditCard, label: 'Transfer' },
                    ].map((m) => {
                      const currentPayMethod = paidState[activeBillIdx]?.payMethod || 'Cash';
                      const Icon = m.icon;
                      return (
                        <button
                          key={m.type}
                          onClick={() => setPaidState({
                            ...paidState,
                            [activeBillIdx]: {
                              ...paidState[activeBillIdx],
                              isPaid: false,
                              payMethod: m.type as PaymentMethod,
                              cash: paidState[activeBillIdx]?.cash || '',
                            },
                          })}
                          className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition border ${
                            currentPayMethod === m.type
                              ? 'bg-brand-600 text-white border-brand-600'
                              : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <Icon size={14} /> {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Cash Input */}
                {(paidState[activeBillIdx]?.payMethod || 'Cash') === 'Cash' && (
                  <div className="space-y-2">
                    <label className="label text-xs mb-1">Uang Tunai Diterima (Rp)</label>
                    <input
                      type="text"
                      value={paidState[activeBillIdx]?.cash || ''}
                      onChange={(e) => setPaidState({
                        ...paidState,
                        [activeBillIdx]: {
                          ...paidState[activeBillIdx],
                          isPaid: false,
                          payMethod: 'Cash',
                          cash: e.target.value.replace(/\D/g, ''),
                        },
                      })}
                      placeholder={`Minimal ${formatRupiah(activeBills[activeBillIdx].totalAmount)}`}
                      className="input text-sm font-bold"
                    />

                    {/* Quick Cash Suggestions */}
                    <div className="flex gap-2 flex-wrap mt-1">
                      {(() => {
                        const targetAmount = activeBills[activeBillIdx].totalAmount;
                        const suggestions: number[] = [targetAmount];
                        const denominators = [5000, 10000, 20000, 50000, 100000];
                        for (const d of denominators) {
                          const rounded = Math.ceil(targetAmount / d) * d;
                          if (rounded > targetAmount && !suggestions.includes(rounded)) {
                            suggestions.push(rounded);
                          }
                        }
                        return suggestions.slice(0, 3).map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setPaidState({
                              ...paidState,
                              [activeBillIdx]: {
                                ...paidState[activeBillIdx],
                                isPaid: false,
                                payMethod: 'Cash',
                                cash: String(val),
                              },
                            })}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-650 transition"
                          >
                            {formatRupiah(val)}
                          </button>
                        ));
                      })()}
                    </div>

                    {/* Change Display */}
                    {(() => {
                      const cashInputVal = parseInt(paidState[activeBillIdx]?.cash || '') || 0;
                      const change = cashInputVal - activeBills[activeBillIdx].totalAmount;
                      if (change > 0) {
                        return (
                          <div className="p-2 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/30 rounded-lg text-xs text-green-700 dark:text-green-400 font-bold flex justify-between items-center mt-1">
                            <span>Kembalian:</span>
                            <span>{formatRupiah(change)}</span>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                )}

                <button
                  onClick={() => handlePaySubBill(activeBillIdx)}
                  className="btn-primary w-full text-sm py-2.5 flex items-center justify-center gap-2"
                >
                  <span>Bayar Sub-Bill {activeBillIdx + 1} ({formatRupiah(activeBills[activeBillIdx].totalAmount)})</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
