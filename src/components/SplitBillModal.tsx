import { useState, useMemo, useEffect, useRef } from 'react';
import Modal from './Modal';
import { formatRupiah } from '../utils/format';
import type { CartItem, PaymentMethod, Transaction, AppSettings, OrderType } from '../types';
import { AtomicTransactionEngine } from '../lib/atomicTransactionEngine';
import { InventoryEngine } from '../lib/inventoryEngine';
import { createSnapshotForCartItems, calculateItemDeductions } from '../utils/hpp';
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
import {
  computeCartSignature,
  createSplitStockSession,
  accumulatePaidPortion,
  computeUnpaidPortion,
  getActiveSplitStockSession,
  setActiveSplitStockSession,
  recordPaidBill,
  isFreshSplitReserveActive,
  cartSignatureMatches,
  resolveSplitQueueNumber,
  computePendingSplitReconcile,
} from '../utils/splitStockSession';
import { Scissors, Users, ShoppingBag, CheckCircle, CreditCard, Banknote, QrCode, ArrowRight, AlertTriangle } from 'lucide-react';

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
  // v4.7 TO DO 21.3: callback saat rekonsiliasi stok pending split dilakukan —
  // POS.tsx memakai ini untuk skip reservedDeductions (anti double-adjust).
  onReconcile?: () => void;
}

type SplitMode = 'equal' | 'item';

/**
 * Re-audit T2 fix: hash pendek deterministik (djb2) — menandai ISI sub-bill pada
 * transactionId agar ID tidak hanya unik per-indeks tapi juga per-KONTEN. Ganti mode
 * (equal ↔ item) yang mengubah komposisi bill pada indeks sama → ID berbeda → engine
 * tidak salah menganggapnya replay dari transaksi lama; double-click bill identik →
 * signature sama → idempotency guard tetap bekerja.
 */
function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 8);
}

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

// Merekam id parent pending yang sudah mencatat visit/promo (untuk split PENDING — fresh split
// memakai `session.visitRecorded`). Keyed by id → tidak butuh reset manual saat parent berubah.
// (Holder sesi reserve aktif ada di modul murni splitStockSession.ts agar POS juga bisa
// melepaskan reserve saat beralih ke checkout normal — v4.5 TO DO 5.1.)
let pendingVisitRecordedId: string | null = null;

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
  onReconcile,
}: SplitBillModalProps) {
  const { settings } = useSettingsStore();
  const { currentUser } = useAuthStore();
  const { addToast } = useToastStore();
  const { updateTxStatus, updateTxMeta } = useTransactionStore();
  const { items: inventory } = useInventoryStore();
  const { menus } = useMenuStore();
  const { recordVisit } = useCustomerStore();
  const { reservePromoUsage } = usePromoStore();

  // v4.5 TO DO 5.1 — Manajemen stok split bill:
  // - Fresh split (tanpa parentTx): stok dipotong SEKALI untuk seluruh item cart saat sub-bill
  //   pertama sesi dibayar (reserve). Sub-bill berikutnya mengirim reservedDeductions = deduksi
  //   item sub-bill itu sendiri → engine menghitung delta 0 sehingga stok tidak terpotong dua kali.
  //   Reserve DI-PERTAHANKAN lintas buka/tutup modal (sesi module-level) agar buka ulang tidak
  //   memotong ganda. Dilepas saat semua lunas atau saat cart berubah (revert bagian belum lunas).
  // - Split pending (parentTx ada): stok sudah dipotong saat pending dibuat → reservedDeductions per sub-bill (delta 0).

  // v4.5 TO DO 5.1: Deteksi perubahan isi cart — jika sesi reserve aktif tapi signature cart
  // berbeda (kasir clear cart / ganti order / batal), kembalikan stok yang BELUM lunas
  // (reserved − paid) dan mulai sesi baru. Bagian yang sudah lunas TIDAK di-revert
  // (stoknya sudah terpakai sah oleh transaksi sub-bill yang tercatat).
  useEffect(() => {
    if (parentTx) return; // split pending tidak memakai session reserve
    const activeSession = getActiveSplitStockSession();
    // v4.7 TO DO 18.8 (A6): cocokkan format baru ATAU legacy — sesi lama tidak boleh
    // dianggap "cart berbeda" (kalau tidak reserve tidak dilepas → double deduction).
    if (activeSession && !cartSignatureMatches(activeSession.cartSignature, cartItems)) {
      const unpaid = computeUnpaidPortion(activeSession);
      if (Object.keys(unpaid).length > 0) {
        useInventoryStore
          .getState()
          .revertStock(unpaid, 'Split Bill (Cart Berubah — Kembalikan Stok Belum Lunas)');
      }
      setActiveSplitStockSession(null);
    }
  }, [cartItems, parentTx]);

  // v4.5 TO DO 5.7: reset UI saat modal dibuka dengan KONTEKS berbeda (parent berbeda / isi cart
  // berubah) — cegah progress lama (paidState/mode/equalCount/itemAssignments) tampil untuk order
  // lain. Reopen konteks SAMA = resume sesi split (5.1) → progress dipertahankan + di-rehydrate
  // dari session (paidBills/mode/count) agar sub-bill yang sudah lunas tidak bisa dibayar ganda.
  const lastOpenCtxRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const cartSig = computeCartSignature(cartItems);
    const ctx = parentTx ? `parent:${parentTx.id}` : `cart:${cartSig}`;
    if (lastOpenCtxRef.current !== ctx) {
      lastOpenCtxRef.current = ctx;
      setMode('equal');
      setEqualCount(2);
      setBillCountCustom(2);
      setActiveBillIdx(0);
      setItemAssignments({});
      setPaidState({});
      // v4.7 TO DO 15.3: reset opsi cetak ke default (cetak semua) saat modal dibuka konteks baru
      setSkipSplitReceipt(false);
      // v4.7 TO DO 21.2: split dari pending → tiket dapur sudah tercetak saat Simpan Pending
      // → skip tiket dapur (anti dobel). Split fresh → cetak semua (tiket belum pernah keluar).
      setSkipSplitKitchen(!!parentTx);
    }
    // Rehydrate paidState dari sesi stock (fresh split) jika masih aktif dengan cart yang sama
    if (!parentTx) {
      const session = getActiveSplitStockSession();
      // v4.7 TO DO 18.8 (A6): format baru ATAU legacy (sesi pra-18.8) dianggap cocok
      if (session && cartSignatureMatches(session.cartSignature, cartItems)) {
        if (session.mode) setMode(session.mode);
        if (session.count) {
          if (session.mode === 'item') setBillCountCustom(session.count);
          else setEqualCount(session.count);
        }
        if (session.paidBills && Object.keys(session.paidBills).length > 0) {
          const rehydrated: Record<number, { isPaid: boolean; payMethod: PaymentMethod; cash: string }> = {};
          Object.entries(session.paidBills).forEach(([idx, info]) => {
            rehydrated[Number(idx)] = {
              isPaid: true,
              payMethod: info.payMethod,
              cash: String(info.cash),
            };
          });
          setPaidState((prev) => ({ ...prev, ...rehydrated }));
        }
        const totalBills = session.count || (session.mode === 'item' ? billCountCustom : equalCount);
        const firstUnpaid = Array.from({ length: totalBills }).findIndex((_, i) => !session.paidBills?.[i]);
        if (firstUnpaid !== -1) setActiveBillIdx(firstUnpaid);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parentTx?.id, cartItems]);

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
    // v4.5 TO DO 5.1: TIDAK me-revert / meng-clear stok di sini — reserve dipertahankan lintas
    // buka/tutup modal agar sesi dapat dilanjutkan tanpa double deduction. Sesi dibersihkan saat:
    // semua sub-bill lunas (di handlePaySubBill) atau isi cart berubah (useEffect di atas).
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

  // v4.5 TO DO 5.2: HPP penuh cart — dipakai untuk mengalokasikan HPP per sub-bill equal
  // (Largest Remainder Method) sehingga Σ hpp sub-bill === HPP induk persis (tanpa selisih rupiah).
  const fullHpp = useMemo(() => {
    try {
      return createSnapshotForCartItems(cartItems, menus, inventory).totalHpp;
    } catch (e) {
      console.warn('[SplitBillModal] Gagal menghitung HPP penuh:', e);
      return 0;
    }
  }, [cartItems, menus, inventory]);
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
  // v4.7 TO DO 15.3: opsi cetak di split bill — dua toggle independen (default: cetak semua)
  const [skipSplitReceipt, setSkipSplitReceipt] = useState(false);
  const [skipSplitKitchen, setSkipSplitKitchen] = useState(false);
  // T2 fix (AUDIT-OX): guard anti double-submit — tombol bayar disabled selama eksekusi async
  const [processingBillIdx, setProcessingBillIdx] = useState<number | null>(null);
  // T2 fix: ID deterministik per sub-bill (basis sesi) — engine idempotency guard aktif
  // di jalur split (double-click / replay tidak membuat transaksi kedua). Untuk split
  // pending, parentTx.id yang dipakai sebagai basis (stabil lintas buka/tutup modal).
  const sessionKeyRef = useRef<string>(Math.random().toString(36).slice(2));

  const activeBills = mode === 'equal' ? equalBills : itemBills;

  // v4.7 TO DO 18.8 (A8): sesi pending split sudah di-rekonsiliasi (parent → cart saat ini)?
  // Sekali per parent — sub-bill memakai delta-0 terhadap CART SAAT INI; rekonsiliasi
  // menyelaraskan reserve stok yang terpotong saat Simpan Pending dengan isi cart sekarang.
  const reconciledPendingSplitRef = useRef<string | null>(null);

  // T2 fix (AUDIT-OX): wrapper anti double-submit — selama eksekusi async berjalan,
  // panggilan ulang diabaikan & tombol disabled (processingBillIdx).
  const handlePaySubBill = async (billIdx: number) => {
    if (processingBillIdx !== null) return;
    setProcessingBillIdx(billIdx);
    try {
      await handlePaySubBillImpl(billIdx);
    } finally {
      setProcessingBillIdx(null);
    }
  };

  const handlePaySubBillImpl = async (billIdx: number) => {
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
        // v4.5 TO DO 5.1: semua sub-bill lunas → stok seluruhnya terpakai sah, sesi selesai.
        setActiveSplitStockSession(null);
        pendingVisitRecordedId = null;
        finalizeSplitParent(nextPaidState);
        addToast('Seluruh Split Bill berhasil dilunasi! 🎉', 'success');
        onCompleteSplit();
        handleClose();
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

    // Pre-open print window if needed — dilewati bila kasir memilih tanpa struk (15.3)
    let preOpenedPrintWindow: Window | null = null;
    if ((settings.printerEnabled || settings.autoPrintOnCheckout) && settings.printerType !== 'bluetooth' && !skipSplitReceipt) {
      preOpenedPrintWindow = window.open('', '_blank', 'width=400,height=600');
    }

    // v4.1 TO DO 1.5 + v4.5 TO DO 5.1 — Stok split bill:
    // Fresh split: validasi SELURUH cart dulu (sebelum sub-bill mana pun dibayar), lalu stok penuh
    // dipotong SEKALI SETELAH commit sub-bill pertama sukses (reserve). Sub-bill berikutnya mengirim
    // reservedDeductions = deduksi item sub-bill itu sendiri → engine menghitung delta 0 (tidak potong 2x).
    // Reserve sesi DI-PERTAHANKAN lintas buka/tutup modal (module-level) → buka ulang tidak deduct ganda.
    // Pending split: stok sudah dipotong saat pending dibuat — cukup reservedDeductions per sub-bill (delta 0).
    const activeSession = getActiveSplitStockSession();

    // v4.7 TO DO 18.8 (A8): rekonsiliasi reserve pending → cart saat ini, SEKALI per parent,
    // saat sub-bill pertama benar-benar dibayar (titik komit). Stok parent terpotong PENUH saat
    // Simpan Pending; bila kasir mengedit cart setelah resume lalu split, item baru harus dipotong
    // & item dihapus dikembalikan — kalau tidak delta-0 per sub-bill mengasumsikan item sub-bill ==
    // item parent → stok bocor. Idempoten: selalu dihitung dari deduksi ORIGINAL parent (tidak
    // pernah menumpuk), dan hanya berjalan bila sub-bill benar-benar dibayar (bila tidak jadi split,
    // jalur finalize pending biasa tetap memakai delta engine — tidak ada double-adjust).
    if (parentTx && reconciledPendingSplitRef.current !== parentTx.id) {
      reconciledPendingSplitRef.current = parentTx.id;
      const parentDeductions = calculateItemDeductions(parentTx.items, menus);
      const currentDeductions = computeDeductions(cartItems);
      const { deltaRevert, deltaDeduct } = computePendingSplitReconcile(
        parentDeductions,
        currentDeductions
      );
      if (Object.keys(deltaRevert).length > 0) {
        useInventoryStore.getState().revertStock(deltaRevert, 'Split Pending (Item Dihapus — Stok Dikembalikan)');
      }
      if (Object.keys(deltaDeduct).length > 0) {
        useInventoryStore.getState().deductStock(deltaDeduct, 'Split Pending (Item Ditambah — Stok Dipotong)');
      }
      if (Object.keys(deltaRevert).length > 0 || Object.keys(deltaDeduct).length > 0) {
        addToast('Isi keranjang berubah sejak pesanan disimpan — stok pending disesuaikan sebelum di-split.', 'info');
      }
      // v4.7 TO DO 21.3: notifikasi POS.tsx bahwa rekonsiliasi sudah dilakukan —
      // POS.tsx akan skip reservedDeductions di finalisasi pending (anti double-adjust).
      onReconcile?.();
    }

    // v4.5 TO DO 5.7 (sabuk pengaman review): tolak re-pay sub-bill yang sudah tercatat lunas di
    // session (kasus rehydrate paidState gagal / sesi lama tanpa paidBills di localStorage) —
    // mencegah duplikasi revenue walau guard UI lolos.
    if (!parentTx && activeSession?.paidBills?.[billIdx]) {
      addToast(`Sub-Bill ${billIdx + 1} sudah lunas pada sesi sebelumnya.`, 'warning');
      return;
    }
    const isFirstPaymentOfSession =
      !parentTx && (!activeSession || Object.keys(activeSession.reserved).length === 0);
    if (isFirstPaymentOfSession) {
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

    // v4.5 TO DO 5.2: HPP sub-bill mode Equal dibawa SEMUA item cart → engine menghitung HPP penuh
    // per sub-bill. Alokasikan HPP induk ke N sub-bill dengan Largest Remainder Method
    // (scaleHpp_i = allocated_i / fullHpp) → Math.round(fullHpp * scaleHpp_i) = allocated_i,
    // sehingga Σ hpp sub-bill === HPP induk persis (laba kotor tidak ter-inflasi N×).
    // Mode item (item disjoint) tidak perlu skala — HPP per sub-bill sudah proporsional alami.
    let scaleHpp: number | undefined;
    if (mode === 'equal' && equalCount > 0 && fullHpp > 0) {
      const allocated = allocateProportional(fullHpp, Array(equalCount).fill(1 / equalCount));
      scaleHpp = allocated[billIdx] / fullHpp;
    }

    // Execute atomic checkout for this Sub-Bill
    const result = await AtomicTransactionEngine.executeCheckout({
      // T2 fix (AUDIT-OX): ID deterministik per sub-bill → in-flight/idempotency guard
      // engine AKTIF di jalur split (double-click tidak membuat transaksi kedua).
      // Re-audit fix: + signature isi bill — ganti mode equal↔item yang mengubah komposisi
      // pada indeks sama menghasilkan ID BERBEDA (bukan salah dianggap replay tx lama),
      // sementara double-click bill identik tetap satu ID (guard jalan).
      transactionId: `${parentTx?.id ?? sessionKeyRef.current}-sub-${billIdx + 1}-${shortHash(
        computeCartSignature(targetBill.items) + ':' + targetBill.totalAmount
      )}`,
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
      // v4.5 TO DO 5.9: sub-bill split FRESH memakai SATU nomor antrean (dari sub-bill pertama sesi)
      // — 1 pesanan tidak menghasilkan N nomor antrean.
      // v4.7 TO DO 18.8 (A7): sub-bill split PENDING memakai nomor antrean PARENT — sebelumnya
      // overrideQueueNumber undefined → engine memanggil getNextQueueNumber PER SUB-BILL → N nomor
      // baru dikonsumsi + counter melompat, dan struk sub-bill bernomor beda dari parent. Sekarang
      // seragam dengan split fresh: 1 pesanan = 1 nomor (struk sub-bill = nomor parent).
      overrideQueueNumber: resolveSplitQueueNumber(parentTx, activeSession),
      splitParentId: parentTx?.id,
      splitIndex: billIdx + 1,
      totalSplitCount: activeBills.length,
      // v4.5 TO DO 5.2: skala HPP sub-bill equal (Σ hpp sub-bill === HPP induk)
      scaleHpp,
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

    // v4.1 TO DO 1.5 + v4.5 TO DO 5.1: Reserve stok penuh HANYA pada pembayaran pertama SESI split
    // fresh (dihitung setelah commit sukses). Sesi module-level dipertahankan lintas buka/tutup modal
    // → sub-bill yang dibayar di sesi sebelumnya TIDAK di-reserve ulang (mencegah double deduction).
    if (isFirstPaymentOfSession) {
      const fullDeductions = computeDeductions(cartItems);
      useInventoryStore.getState().deductStock(fullDeductions, 'Split Bill (Reserve Stok Semua Item)');
      let session = getActiveSplitStockSession();
      if (!session) {
        session = createSplitStockSession(computeCartSignature(cartItems), {});
      }
      session.reserved = fullDeductions;
      setActiveSplitStockSession(session);
    }

    // v4.1 TO DO 2.8: rekam kunjungan customer & usage promo SEKALI per sesi split.
    // Fresh split → flag di session (bertahan lintas buka/tutup); pending split → keyed by parent id.
    // v4.7 TO DO 18.8 (E7): usage promo dicatat via reservePromoUsage — cek batas dari STORE saat
    // commit (bukan render) + ledger usageKey subTx.id (anti double-increment saat replay).
    const recordPromoUsage = () => {
      if (!appliedPromoId) return;
      const res = reservePromoUsage(appliedPromoId, selectedCustomerId || undefined, subTx.id);
      if (!res.ok && res.reason === 'limit-reached') {
        addToast('Promo sudah mencapai batas pemakaian — pembayaran tetap diproses tanpa menambah pemakaian promo.', 'warning', 6000);
      }
    };
    if (!parentTx) {
      const session = getActiveSplitStockSession();
      if (session && !session.visitRecorded) {
        session.visitRecorded = true;
        setActiveSplitStockSession(session);
        if (selectedCustomerId) {
          recordVisit(selectedCustomerId, totalAmount);
        }
        recordPromoUsage();
      }
    } else {
      if (pendingVisitRecordedId !== parentTx.id) {
        pendingVisitRecordedId = parentTx.id;
        if (selectedCustomerId) {
          recordVisit(selectedCustomerId, totalAmount);
        }
        recordPromoUsage();
      }
    }

    // v4.5 TO DO 5.1: Akumulasi stok sub-bill yang lunas ke sesi, di-CAP pada nilai reserve.
    // Tanpa cap, mode Equal (semua sub-bill membawa semua item) mengakumulasi deduksi penuh
    // berulang → reserved − paid ≤ 0 → revert tidak pernah benar → stok bocor ganda.
    if (!parentTx) {
      const session = getActiveSplitStockSession();
      if (session) {
        accumulatePaidPortion(session, reservedForSubBill);
        // v4.5 TO DO 5.7: catat sub-bill lunas + konfigurasi sesi (rehydrate UI saat reopen)
        recordPaidBill(session, billIdx, payMethod, cash);
        session.mode = mode;
        session.count = mode === 'equal' ? equalCount : billCountCustom;
        // v4.5 TO DO 5.9: kunci SATU nomor antrean untuk seluruh sub-bill fresh (yang pertama menang)
        if (!session.queueNumber) session.queueNumber = subTx.queueNumber;
        setActiveSplitStockSession(session);
      }
    }

    // Cetak struk sub-bill. Saat split fresh sub-bill pertama, cetak juga tiket dapur LENGKAP sekali
    // (dapur belum pernah menerima tiket). Split pending tidak mencetak ulang tiket (sudah saat pending dibuat).
    // v4.7 TO DO 15.3: dua toggle independen — skipSplitReceipt (struk kasir dilewati) &
    // skipSplitKitchen (tiket dapur dilewati — anti tiket DOBEL saat split dari pending).
    if (settings.printerEnabled || settings.autoPrintOnCheckout) {
      if (isFirstPaymentOfSession) {
        printSplitReceipt(subTx, null, settings, 'all', cartItems, skipSplitReceipt, skipSplitKitchen).catch(() => {});
      } else {
        printSplitReceipt(subTx, parentTx, settings, 'cashier', undefined, skipSplitReceipt, skipSplitKitchen).catch(() => {});
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
      // v4.5 TO DO 5.1: semua sub-bill lunas → stok seluruhnya terpakai sah, sesi selesai.
      setActiveSplitStockSession(null);
      pendingVisitRecordedId = null;
      finalizeSplitParent(nextPaidState);
      addToast(`Seluruh Split Bill berhasil dilunasi! 🎉`, 'success');
      onCompleteSplit();
      handleClose();
    } else {
      // Move to next unpaid bill
      const nextUnpaid = activeBills.findIndex((_, idx) => !nextPaidState[idx]?.isPaid);
      if (nextUnpaid !== -1) setActiveBillIdx(nextUnpaid);
    }
  };

  // v4.7 TO DO 18.4: sesi reserve split FRESH tersimpan di localStorage DEVICE INI saja —
  // kasir lain tidak tahu reserve ini. Baca langsung saat render (sesi dibuat/dibersihkan
  // oleh handler komponen ini yang selalu setState → re-render; POS melepas sesi hanya saat
  // modal tertutup, jadi render-time read sudah cukup akurat).
  const freshReserveActive = isFreshSplitReserveActive(parentTx, getActiveSplitStockSession());

  return (
    <Modal open={open} onClose={handleClose} title="✂️ Split Bill (Pisah Pembayaran)" maxWidth="max-w-3xl">
      <div className="space-y-4">
        {/* v4.7 TO DO 18.4: warning batasan reserve per-device (hanya split FRESH) */}
        {freshReserveActive && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <p className="font-semibold">Stok item di-reserve hanya di device ini</p>
              <p className="mt-0.5 opacity-90">
                Sesi split berjalan di perangkat/kasir ini saja — kasir lain di device berbeda
                tidak mengetahui reserve stok ini dan bisa menjual item yang sama. Selesaikan
                semua sub-bill di device ini sebelum berpindah kasir/device.
              </p>
            </div>
          </div>
        )}

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
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition"
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

                {/* v4.7 TO DO 15.3: opsi cetak tanpa struk per sub-bill (hemat kertas)
                    TO DO 17.2: berdampingan (row) di desktop, vertikal di mobile */}
                {(settings.printerEnabled || settings.autoPrintOnCheckout) && (
                  <div className="flex flex-col gap-1.5 text-xs text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:gap-6">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!skipSplitReceipt}
                        onChange={(e) => setSkipSplitReceipt(!e.target.checked)}
                        className="accent-brand-600 h-4 w-4"
                      />
                      <span>Cetak struk kasir</span>
                    </label>
                    {!parentTx && (
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!skipSplitKitchen}
                          onChange={(e) => setSkipSplitKitchen(!e.target.checked)}
                          className="accent-brand-600 h-4 w-4"
                        />
                        <span>Cetak tiket dapur</span>
                      </label>
                    )}
                    {skipSplitReceipt && skipSplitKitchen && (
                      <span className="text-slate-400 dark:text-slate-500 sm:basis-full">(tidak ada cetakan sama sekali)</span>
                    )}
                  </div>
                )}

                <button
                  onClick={() => handlePaySubBill(activeBillIdx)}
                  disabled={processingBillIdx !== null}
                  className="btn-primary w-full text-sm py-2.5 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>
                    {processingBillIdx !== null
                      ? 'Memproses pembayaran…'
                      : `Bayar Sub-Bill ${activeBillIdx + 1} (${formatRupiah(activeBills[activeBillIdx].totalAmount)})`}
                  </span>
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
