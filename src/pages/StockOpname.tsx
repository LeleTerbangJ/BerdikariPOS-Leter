import { useState, useMemo, useEffect, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import { useInventoryStore } from '../store/inventoryStore';
import { useStockLogStore } from '../store/stockLogStore';
import { useStockOpnameStore } from '../store/stockOpnameStore';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { useToastStore } from '../store/toastStore';
import { formatRupiah, formatDate } from '../utils/format';
import {
  findDriftedOpnameItems,
  resolveOpnameGate,
  shouldShowLargeDifferenceBanner,
  fillMissingItemReasons,
  parseActualStock,
  type StockDrift,
} from '../utils/stockImport';
import type { StockOpnameItem, StockOpname as StockOpnameType } from '../types';
import type { ApproverInfo } from '../utils/pinAuth';
import { getDeviceMarker } from '../utils/pinAuth';
import PinModal from '../components/PinModal';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import { AlertTriangle, CheckCircle, History, Search, ClipboardCheck, EyeOff } from 'lucide-react';

const REASON_OPTIONS = ['Basi', 'Bahan Rusak', 'Salah Input', 'Tercecer', 'Penyusutan', 'Lainnya'];

interface OpnameRow {
  inventoryId: string;
  name: string;
  unit: string;
  systemStock: number;
  costPerUnit: number;
  actualStock: string;
  reason: string;
}

export default function StockOpname() {
  const { addToast } = useToastStore();
  const { items: inventory, applyBulkStock } = useInventoryStore();
  const { addLog: addStockLog } = useStockLogStore();
  const { records, addRecord } = useStockOpnameStore();
  const { currentUser } = useAuthStore();
  const { settings } = useSettingsStore();
  const { addLog: addAuditLog } = useAuditLogStore();

  const isWarehouseStaff = currentUser?.role === 'Staf Gudang';

  const [view, setView] = useState<'form' | 'history'>('form');
  const [rows, setRows] = useState<OpnameRow[]>(() =>
    inventory.map((i) => ({
      inventoryId: i.id, name: i.name, unit: i.unit,
      systemStock: i.stock, costPerUnit: i.costPerUnit,
      actualStock: '', reason: '',
    }))
  );
  const [notes, setNotes] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  // Re-audit T10: debounce toast sinkronisasi (anti double-fire StrictMode & burst realtime)
  const lastSyncToastRef = useRef(0);

  // T10 fix (AUDIT-OX): sinkronkan stok sistem & cost baris saat inventory berubah
  // (realtime lintas device / mutasi POS di device sama). Sebelumnya snapshot hanya di-mount →
  // form memakai dasar basi: dialog drift muncul untuk hampir semua item, atau lebih buruk,
  // opname menimpa stok terkini dengan dasar basi. Input kasir (actualStock & alasan) TIDAK disentuh.
  // Re-audit fix: toast agregat bila perubahan mengenai baris yang SUDAH diisi kasir —
  // pratinjau selisihnya bergeser, jangan biarkan tanpa kabar.
  useEffect(() => {
    setRows((prevRows) => {
      if (prevRows.length === 0) {
        // Mount pertama — cukup bangun dari inventory (tanpa toast)
        return inventory.map((i) => ({
          inventoryId: i.id, name: i.name, unit: i.unit,
          systemStock: i.stock, costPerUnit: i.costPerUnit,
          actualStock: '', reason: '',
        }));
      }
      const prevById = new Map(prevRows.map((r) => [r.inventoryId, r]));
      let affectedInputs = 0;
      const refreshed = inventory.map((i) => {
        const prev = prevById.get(i.id);
        const row = {
          inventoryId: i.id,
          name: i.name,
          unit: i.unit,
          systemStock: i.stock,
          costPerUnit: i.costPerUnit,
          actualStock: prev?.actualStock ?? '',
          reason: prev?.reason ?? '',
        };
        // Baris sudah diisi kasir DAN dasar pembandingnya berubah → masuk hitungan notifikasi
        if (prev && row.actualStock !== '' && prev.systemStock !== row.systemStock) affectedInputs++;
        return row;
      });
      // Debounce 3 dtk: StrictMode dev memanggil updater 2x & burst realtime tidak menumpuk toast
      if (affectedInputs > 0 && Date.now() - lastSyncToastRef.current > 3000) {
        lastSyncToastRef.current = Date.now();
        addToast(
          `Stok sistem ${affectedInputs} item berubah selagi form terbuka — pratinjau selisih diperbarui dengan dasar terbaru.`,
          'info'
        );
      }
      // Pertahankan ketikan kasir untuk item yang sudah tidak ada di inventory (tidak ikut commit)
      const invIds = new Set(inventory.map((i) => i.id));
      const orphans = prevRows.filter((r) => !invIds.has(r.inventoryId));
      return [...refreshed, ...orphans];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory]);
  const [unitFilter, setUnitFilter] = useState('all');
  const [opnamePerPage, setOpnamePerPage] = useState(10);
  const [opnamePage, setOpnamePage] = useState(1);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // v4.7 TO DO 9.2: item yang stoknya berubah di perangkat lain sejak form dibuka (race lintas device)
  const [driftConfirm, setDriftConfirm] = useState<{ items: StockDrift[] } | null>(null);
  // v4.7 TO DO 10.2: approver (Manager) yang menyetujui — identitas dicatat TERPISAH dari staff penginput.
  const [approver, setApprover] = useState<ApproverInfo | null>(null);
  // v4.7 TO DO 10.3: dialog alasan utama wajib pasca-PIN untuk Staf Gudang (dual-control + jejak audit).
  const [showReasonDialog, setShowReasonDialog] = useState(false);
  const [reasonChoice, setReasonChoice] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');

  // Unique units for filter dropdown
  const uniqueUnits = useMemo(() => {
    const units = new Set(inventory.map((i) => i.unit));
    return Array.from(units).sort();
  }, [inventory]);

  // Computed: items with differences
  const opnameItems = useMemo((): StockOpnameItem[] => {
    return rows
      .filter((r) => r.actualStock !== '')
      .map((r) => {
        // v4.7 TO DO 10.4: clamp negatif/NaN — nilai inilah yang ditulis ke inventory.
        const actual = parseActualStock(r.actualStock);
        const diff = actual - r.systemStock;
        const loss = diff < 0 ? Math.abs(diff) * r.costPerUnit : 0;
        return {
          inventoryId: r.inventoryId, inventoryName: r.name, unit: r.unit,
          systemStock: r.systemStock, actualStock: actual, difference: diff,
          costPerUnit: r.costPerUnit, lossValue: loss, reason: r.reason || '-',
        };
      });
  }, [rows]);

  const totalLoss = opnameItems.reduce((a, i) => a + i.lossValue, 0);
  const itemsWithDiff = opnameItems.filter((i) => i.difference !== 0).length;
  // PIN trigger: any item with difference >= 10% of system stock
  // v4.7 TO DO 10.5 (catatan desain): ambang = max(10% stok sistem, 1 unit). Untuk item dengan
  // stok sistem < 10 (mis. stok 5, selisih 1 = 20%), ambang 1 unit membuat PIN lebih sering
  // muncul — ketat tapi DISENGAJA (validasi stok rendah lebih ketat). Tidak diubah.
  const hasLargeDifference = opnameItems.some((i) => {
    const threshold = Math.max(i.systemStock * 0.1, 1);
    return Math.abs(i.difference) >= threshold;
  });
  const filledCount = opnameItems.length;

  // Filtered + paginated rows
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const matchSearch = !searchFilter || r.name.toLowerCase().includes(searchFilter.toLowerCase());
      const matchUnit = unitFilter === 'all' || r.unit === unitFilter;
      return matchSearch && matchUnit;
    });
  }, [rows, searchFilter, unitFilter]);

  const totalFilteredPages = Math.ceil(filteredRows.length / opnamePerPage);
  const paginatedRows = filteredRows.slice((opnamePage - 1) * opnamePerPage, opnamePage * opnamePerPage);

  const updateRow = (filteredIdx: number, field: keyof OpnameRow, value: string) => {
    const targetId = paginatedRows[filteredIdx]?.inventoryId;
    if (!targetId) return;
    setRows((prev) => prev.map((r) => (r.inventoryId === targetId ? { ...r, [field]: value } : r)));
  };

  // Gate konfirmasi: PIN Manager atau dialog konfirmasi biasa.
  // v4.7 TO DO 10.1: Staf Gudang SELALU lewat PIN (jalur seragam) — tanpa banner/ConfirmDialog
  // terpisah agar tidak ada sinyal diferensial (oracle ±10% untuk membaca stok sistem).
  const proceedToConfirm = () => {
    if (resolveOpnameGate(isWarehouseStaff, hasLargeDifference) === 'pin') {
      setShowPinModal(true);
    } else {
      setShowConfirm(true);
    }
  };

  const handleSubmitAttempt = () => {
    // v4.7 TO DO 20.2: alert → toast
    if (filledCount === 0) return addToast('Mohon isi setidaknya 1 item stok aktual.', 'warning');
    
    // Only require reasons for differences if the user is NOT Staf Gudang (blind opname mode)
    if (!isWarehouseStaff) {
      const missingReason = opnameItems.filter((i) => i.difference !== 0 && (!i.reason || i.reason === '-'));
      if (missingReason.length > 0) {
        // v4.7 TO DO 20.2: alert → toast
        return addToast(`${missingReason.length} item dengan selisih belum diisi alasannya.`, 'warning');
      }
    }

    // v4.7 TO DO 9.2: guard race lintas device — form menangkap systemStock saat DIBUKA;
    // jika perangkat lain mengubah stok sejak itu, menulis stok absolut akan menimpa hasilnya
    // (lost update) tanpa jejak. Deteksi & minta konfirmasi sebelum commit.
    const drifted = findDriftedOpnameItems(opnameItems, inventory);
    if (drifted.length > 0) {
      setDriftConfirm({ items: drifted });
      return;
    }

    proceedToConfirm();
  };

  const doSubmit = (pinVerified: boolean, approver?: ApproverInfo, adjustmentReason?: string, reasonDetailText?: string) => {
    if (!currentUser) return;
    // v4.7 TO DO 10.3: alasan utama (wajib Staf Gudang pasca-PIN) diterapkan ke item berselisih
    // yang belum punya alasan — jejak audit penyebab kerugian tidak lagi kosong/'-'.
    const items = adjustmentReason ? fillMissingItemReasons(opnameItems, adjustmentReason) : opnameItems;
    const finalNotes = adjustmentReason
      ? [notes?.trim(), `Alasan: ${adjustmentReason}${reasonDetailText ? ` — ${reasonDetailText}` : ''}`].filter(Boolean).join('\n')
      : notes?.trim() || undefined;
    const record: StockOpnameType = {
      id: uuid(), date: new Date().toISOString(),
      staffId: currentUser.id, staffName: currentUser.name,
      items, totalLossValue: totalLoss,
      totalItems: filledCount, itemsWithDifference: itemsWithDiff,
      pinVerified,
      // v4.7 TO DO 10.2: identitas approver + jejak audit (timestamp + penanda perangkat).
      approverId: approver?.id,
      approverName: approver?.name,
      approverRole: approver?.role,
      approvedAt: pinVerified ? new Date().toISOString() : undefined,
      deviceId: pinVerified ? getDeviceMarker() : undefined,
      adjustmentReason,
      notes: finalNotes,
    };
    addRecord(record);

    // v4.7 TO DO 9.4: batch — SATU setState + SATU syncInventoryStock bulk (bukan N × syncInventoryItem)
    const stockEntries: { id: string; stock: number }[] = [];
    for (const item of items) {
      if (item.difference !== 0) {
        addStockLog({
          id: uuid(), inventoryId: item.inventoryId, inventoryName: item.inventoryName,
          type: 'adjust', amount: item.difference,
          stockBefore: item.systemStock, stockAfter: item.actualStock,
          unit: item.unit, reason: `Stock Opname: ${item.reason}`,
          date: new Date().toISOString(),
        });
        stockEntries.push({ id: item.inventoryId, stock: item.actualStock });
      }
    }
    applyBulkStock(stockEntries);

    addAuditLog(currentUser.id, currentUser.name, currentUser.role, 'stock_opname',
      `Stock Opname: ${filledCount} item, ${itemsWithDiff} selisih, Kerugian: ${formatRupiah(totalLoss)}` +
        (approver ? ` — Disetujui oleh ${approver.name}` : ''),
      { opnameId: record.id, totalLoss, itemsWithDiff, pinVerified, approverId: approver?.id, approverName: approver?.name, approvedAt: record.approvedAt, deviceId: record.deviceId, adjustmentReason }
    );

    // Reset
    setRows(inventory.map((i) => ({
      inventoryId: i.id, name: i.name, unit: i.unit,
      systemStock: i.stock, costPerUnit: i.costPerUnit,
      actualStock: '', reason: '',
    })));
    setNotes('');
    setView('history');
    // v4.7 TO DO 20.2: alert → toast
    addToast('✅ Stock Opname berhasil disimpan dan stok telah diperbarui.', 'success');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-center sm:text-left w-full sm:w-auto">📋 Stock Opname</h1>
        <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
          <button onClick={() => setView('form')} className={`text-sm px-4 py-2 rounded-lg font-medium transition flex items-center justify-center gap-1.5 w-full sm:w-auto ${view === 'form' ? 'bg-brand-600 text-white' : 'btn-secondary'}`}>
            <ClipboardCheck size={14} /> Input Opname
          </button>
          <button onClick={() => setView('history')} className={`text-sm px-4 py-2 rounded-lg font-medium transition flex items-center justify-center gap-1.5 w-full sm:w-auto ${view === 'history' ? 'bg-brand-600 text-white' : 'btn-secondary'}`}>
            <History size={14} /> Riwayat
          </button>
        </div>
      </div>

      {view === 'form' && (
        <div className="space-y-4">
          {/* Blind Opname Banner for Staf Gudang */}
          {isWarehouseStaff && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-300">
              <EyeOff size={18} className="text-amber-600 flex-shrink-0" />
              <span>
                <strong>Mode Stock Opname Buta:</strong> Untuk meningkatkan akurasi perhitungan fisik, stok sistem dan indikator selisih disembunyikan untuk akun Staf Gudang.
              </span>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="card p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Item Diisi</p>
              <p className="text-xl font-bold text-brand-700 dark:text-brand-400">{filledCount} <span className="text-sm font-normal text-slate-400">/ {rows.length}</span></p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Item Selisih</p>
              <p className={`text-xl font-bold ${isWarehouseStaff ? 'text-slate-400 text-sm font-medium' : itemsWithDiff > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {isWarehouseStaff ? '🔒 Sembunyi (Opname Buta)' : itemsWithDiff}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Estimasi Kerugian</p>
              <p className={`text-xl font-bold ${isWarehouseStaff ? 'text-slate-400 text-sm font-medium' : totalLoss > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {isWarehouseStaff ? '🔒 Sembunyi (Opname Buta)' : formatRupiah(totalLoss)}
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input type="text" value={searchFilter} onChange={(e) => { setSearchFilter(e.target.value); setOpnamePage(1); }}
                placeholder="Cari bahan..." className="input pl-8 text-sm" />
            </div>
            <select value={unitFilter} onChange={(e) => { setUnitFilter(e.target.value); setOpnamePage(1); }} className="input w-auto text-sm">
              <option value="all">Semua Unit</option>
              {uniqueUnits.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <select value={opnamePerPage} onChange={(e) => { setOpnamePerPage(Number(e.target.value)); setOpnamePage(1); }} className="input w-auto text-sm">
              <option value={10}>10 / halaman</option>
              <option value={25}>25 / halaman</option>
              <option value={50}>50 / halaman</option>
              <option value={100}>100 / halaman</option>
            </select>
          </div>

          {/* Input Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-700">
                  <tr>
                    <th className="text-left p-3 font-semibold min-w-[140px]">Bahan Baku</th>
                    <th className="text-right p-3 font-semibold">Stok Sistem</th>
                    <th className="text-center p-3 font-semibold min-w-[100px]">Stok Fisik</th>
                    <th className="text-right p-3 font-semibold">Selisih</th>
                    <th className="text-right p-3 font-semibold">Kerugian</th>
                    <th className="text-left p-3 font-semibold min-w-[140px]">Alasan</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row, idx) => {
                    // v4.7 TO DO 10.4: preview memakai nilai ter-clamp yang sama dengan yang disimpan.
                    const actual = parseActualStock(row.actualStock);
                    const diff = row.actualStock !== '' ? actual - row.systemStock : null;
                    const loss = diff !== null && diff < 0 ? Math.abs(diff) * row.costPerUnit : 0;
                    const hasDiff = diff !== null && diff !== 0;
                    const showRowHighlight = !isWarehouseStaff && hasDiff;
                    return (
                      <tr key={row.inventoryId} className={`border-b border-slate-50 dark:border-slate-700/40 ${showRowHighlight ? (diff! < 0 ? 'bg-red-50/50 dark:bg-red-950/10' : 'bg-blue-50/50 dark:bg-blue-950/10') : ''}`}>
                        <td className="p-3">
                          <span className="font-medium">{row.name}</span>
                          <span className="text-xs text-slate-400 ml-1">({row.unit})</span>
                        </td>
                        <td className="p-3 text-right font-mono">
                          {isWarehouseStaff ? <span className="text-slate-400 text-xs font-normal">🔒 ***</span> : row.systemStock.toFixed(1)}
                        </td>
                        <td className="p-3">
                          <input type="number" step="0.1" min="0" value={row.actualStock} onChange={(e) => updateRow(idx, 'actualStock', e.target.value)}
                            className="input py-1 px-2 text-center text-sm w-full" placeholder="—" />
                        </td>
                        <td className="p-3 text-right font-mono">
                          {isWarehouseStaff ? (
                            <span className="text-slate-300">—</span>
                          ) : diff !== null ? (
                            <span className={`font-bold ${diff > 0 ? 'text-blue-600' : diff < 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {diff > 0 ? '+' : ''}{diff.toFixed(1)}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {isWarehouseStaff ? (
                            <span className="text-slate-300">—</span>
                          ) : loss > 0 ? (
                            <span className="text-red-600 font-semibold">{formatRupiah(loss)}</span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="p-3">
                          {isWarehouseStaff || hasDiff ? (
                            <select value={row.reason} onChange={(e) => updateRow(idx, 'reason', e.target.value)} className="input py-1 px-2 text-xs w-full">
                              <option value="">Pilih alasan (opsional)...</option>
                              {REASON_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalFilteredPages > 1 && (
              <div className="flex items-center justify-between p-3 border-t border-slate-100 dark:border-slate-700">
                <p className="text-xs text-slate-500">{(opnamePage - 1) * opnamePerPage + 1}–{Math.min(opnamePage * opnamePerPage, filteredRows.length)} dari {filteredRows.length}</p>
                <div className="flex gap-1">
                  {Array.from({ length: totalFilteredPages }, (_, i) => (
                    <button key={i} onClick={() => setOpnamePage(i + 1)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium ${opnamePage === i + 1 ? 'bg-brand-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Notes & Submit */}
          <div className="card p-4 space-y-3">
            <div>
              <label className="label">Catatan Tambahan (Opsional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input" rows={2} placeholder="Catatan untuk opname ini..." />
            </div>
            {shouldShowLargeDifferenceBanner(isWarehouseStaff, hasLargeDifference) && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl flex items-start gap-2">
                <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  <strong>Selisih Besar Terdeteksi.</strong> Item dengan selisih ≥10% dari stok sistem ditemukan. PIN Manager diperlukan untuk menyetujui opname.
                </p>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">Petugas: <strong>{currentUser?.name}</strong></span>
              <div className="flex-1" />
              <button onClick={() => {
                setRows(inventory.map((i) => ({ inventoryId: i.id, name: i.name, unit: i.unit, systemStock: i.stock, costPerUnit: i.costPerUnit, actualStock: '', reason: '' })));
                setNotes('');
              }} className="btn-secondary text-sm">Reset</button>
              <button onClick={handleSubmitAttempt} className="btn-primary text-sm" disabled={filledCount === 0}>
                <CheckCircle size={14} /> Simpan Opname
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History View */}
      {view === 'history' && (
        <div className="space-y-4">
          {records.length === 0 ? (
            <div className="card p-8 text-center"><p className="text-slate-400">Belum ada riwayat stock opname.</p></div>
          ) : records.slice(0, 50).map((rec) => (
            <div key={rec.id} className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">{formatDate(rec.date)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Oleh: {rec.staffName}{' '}
                    {rec.pinVerified && (
                      <span className="text-green-600">✓ {rec.approverName ? `Disetujui ${rec.approverName}` : 'PIN Verified'}</span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  {isWarehouseStaff ? (
                    <p className="text-xs text-slate-400 font-medium">{rec.totalItems} item dihitung (🔒 Opname Buta)</p>
                  ) : (
                    <>
                      <p className="text-xs text-slate-400">{rec.totalItems} item, {rec.itemsWithDifference} selisih</p>
                      <p className={`text-sm font-bold ${rec.totalLossValue > 0 ? 'text-red-600' : 'text-green-600'}`}>Kerugian: {formatRupiah(rec.totalLossValue)}</p>
                    </>
                  )}
                </div>
              </div>
              {rec.notes && <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">{rec.notes}</p>}
              {rec.adjustmentReason && <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">Alasan penyesuaian: <strong>{rec.adjustmentReason}</strong></p>}
              {rec.items.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/80">
                      <tr>
                        <th className="text-left p-2">Bahan</th>
                        <th className="text-right p-2">Sistem</th>
                        <th className="text-right p-2">Aktual</th>
                        <th className="text-right p-2">Selisih</th>
                        <th className="text-right p-2">Kerugian</th>
                        <th className="text-left p-2">Alasan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.items.filter((i) => !isWarehouseStaff ? i.difference !== 0 : true).map((item, idx) => (
                        <tr key={idx} className="border-t border-slate-100 dark:border-slate-700/30">
                          <td className="p-2 font-medium">{item.inventoryName} <span className="text-slate-400">({item.unit})</span></td>
                          <td className="p-2 text-right font-mono">{isWarehouseStaff ? '🔒 ***' : item.systemStock.toFixed(1)}</td>
                          <td className="p-2 text-right font-mono">{item.actualStock.toFixed(1)}</td>
                          <td className={`p-2 text-right font-mono ${isWarehouseStaff ? 'text-slate-400' : item.difference < 0 ? 'text-red-600 font-bold' : 'text-blue-600 font-bold'}`}>
                            {isWarehouseStaff ? '🔒 ***' : `${item.difference > 0 ? '+' : ''}${item.difference.toFixed(1)}`}
                          </td>
                          <td className="p-2 text-right">{isWarehouseStaff ? '🔒 ***' : item.lossValue > 0 ? <span className="text-red-600">{formatRupiah(item.lossValue)}</span> : '—'}</td>
                          <td className="p-2">{item.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* v4.7 TO DO 10.1: judul generik untuk Staf Gudang — tanpa menyebut "Selisih Besar" */}
      <PinModal open={showPinModal} onClose={() => setShowPinModal(false)}
        requireManager
        onSuccess={(approver) => {
          setShowPinModal(false);
          // v4.7 TO DO 10.3: Staf Gudang (mode buta) wajib pilih alasan utama SETELAH PIN disetujui —
          // rangkuman selisih + alasan sebelum eksekusi (dual-control & jejak audit penyebab kerugian).
          if (isWarehouseStaff && itemsWithDiff > 0) {
            setApprover(approver ?? null);
            setReasonChoice('');
            setReasonDetail('');
            setShowReasonDialog(true);
          } else {
            doSubmit(true, approver);
          }
        }}
        title={isWarehouseStaff ? 'Otorisasi Manager' : 'Verifikasi PIN Manager — Selisih Besar'} />
      {/* v4.7 TO DO 10.3: alasan utama wajib untuk Staf Gudang setelah PIN Manager disetujui */}
      <Modal open={showReasonDialog} onClose={() => setShowReasonDialog(false)}
        title="Alasan Penyesuaian (Wajib)" maxWidth="max-w-md">
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl text-xs text-amber-800 dark:text-amber-300">
            <p><strong>PIN Manager disetujui.</strong> {itemsWithDiff} item memiliki selisih stok.</p>
            <p className="mt-1">Pilih alasan utama untuk penyesuaian ini sebelum data disimpan — alasan dicatat untuk audit penyebab kerugian.</p>
          </div>
          <div>
            <label className="label">Alasan Utama</label>
            <select value={reasonChoice} onChange={(e) => setReasonChoice(e.target.value)} className="input">
              <option value="">— Pilih alasan —</option>
              {REASON_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Detail (Opsional)</label>
            <textarea value={reasonDetail} onChange={(e) => setReasonDetail(e.target.value)} className="input" rows={2} placeholder="Keterangan tambahan (jika ada)..." />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowReasonDialog(false)} className="btn-secondary flex-1">Batal</button>
            <button onClick={() => { if (reasonChoice) { setShowReasonDialog(false); doSubmit(true, approver ?? undefined, reasonChoice, reasonDetail.trim()); } }}
              disabled={!reasonChoice} className="btn-primary flex-1">Eksekusi Opname</button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={showConfirm} onClose={() => setShowConfirm(false)}
        onConfirm={() => { setShowConfirm(false); doSubmit(false); }}
        title="Konfirmasi Stock Opname"
        message={isWarehouseStaff ? `Simpan hasil opname ${filledCount} item fisik? Data stok inventory akan diperbarui.` : `Simpan hasil opname ${filledCount} item? ${itemsWithDiff} item memiliki selisih. Stok di inventory akan diperbarui sesuai stok fisik.`} />
      {/* v4.7 TO DO 9.2: peringatan stok berubah sejak form dibuka (race lintas device) */}
      <ConfirmDialog open={!!driftConfirm} onClose={() => setDriftConfirm(null)}
        onConfirm={() => { setDriftConfirm(null); proceedToConfirm(); }}
        title="⚠️ Stok Berubah Sejak Form Dibuka"
        message={isWarehouseStaff
          ? `${driftConfirm?.items.length ?? 0} item memiliki stok yang berubah di perangkat lain sejak form ini dibuka. Lanjutkan dengan stok fisik yang dihitung? Stok terkini akan ditimpa.`
          : `Stok beberapa item berubah sejak form dibuka (kemungkinan ada transaksi di perangkat lain): ${driftConfirm?.items.map((d) => `${d.name} (${d.systemStock} → ${d.currentStock} ${d.unit})`).join(', ')}. Lanjutkan menulis stok fisik?`
        } />
    </div>
  );
}
