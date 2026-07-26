import { useState, useMemo } from 'react';
import { v4 as uuid } from 'uuid';
import { useInventoryStore } from '../store/inventoryStore';
import { useStockLogStore } from '../store/stockLogStore';
import { useStockOpnameStore } from '../store/stockOpnameStore';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { formatRupiah, formatDate } from '../utils/format';
import type { StockOpnameItem, StockOpname as StockOpnameType } from '../types';
import PinModal from '../components/PinModal';
import ConfirmDialog from '../components/ConfirmDialog';
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
  const { items: inventory, updateItem } = useInventoryStore();
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
  const [unitFilter, setUnitFilter] = useState('all');
  const [opnamePerPage, setOpnamePerPage] = useState(10);
  const [opnamePage, setOpnamePage] = useState(1);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

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
        const actual = parseFloat(r.actualStock) || 0;
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

  const handleSubmitAttempt = () => {
    if (filledCount === 0) return alert('Mohon isi setidaknya 1 item stok aktual.');
    
    // Only require reasons for differences if the user is NOT Staf Gudang (blind opname mode)
    if (!isWarehouseStaff) {
      const missingReason = opnameItems.filter((i) => i.difference !== 0 && (!i.reason || i.reason === '-'));
      if (missingReason.length > 0) {
        return alert(`${missingReason.length} item dengan selisih belum diisi alasannya.`);
      }
    }

    if (hasLargeDifference) {
      setShowPinModal(true);
    } else {
      setShowConfirm(true);
    }
  };

  const doSubmit = (pinVerified: boolean) => {
    if (!currentUser) return;
    const record: StockOpnameType = {
      id: uuid(), date: new Date().toISOString(),
      staffId: currentUser.id, staffName: currentUser.name,
      items: opnameItems, totalLossValue: totalLoss,
      totalItems: filledCount, itemsWithDifference: itemsWithDiff,
      pinVerified, notes: notes || undefined,
    };
    addRecord(record);

    for (const item of opnameItems) {
      if (item.difference !== 0) {
        addStockLog({
          id: uuid(), inventoryId: item.inventoryId, inventoryName: item.inventoryName,
          type: 'adjust', amount: item.difference,
          stockBefore: item.systemStock, stockAfter: item.actualStock,
          unit: item.unit, reason: `Stock Opname: ${item.reason}`,
          date: new Date().toISOString(),
        });
        updateItem(item.inventoryId, { stock: item.actualStock }, { skipLog: true });
      }
    }

    addAuditLog(currentUser.id, currentUser.name, currentUser.role, 'stock_opname',
      `Stock Opname: ${filledCount} item, ${itemsWithDiff} selisih, Kerugian: ${formatRupiah(totalLoss)}`,
      { opnameId: record.id, totalLoss, itemsWithDiff, pinVerified }
    );

    // Reset
    setRows(inventory.map((i) => ({
      inventoryId: i.id, name: i.name, unit: i.unit,
      systemStock: i.stock, costPerUnit: i.costPerUnit,
      actualStock: '', reason: '',
    })));
    setNotes('');
    setView('history');
    alert('✅ Stock Opname berhasil disimpan dan stok telah diperbarui.');
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
                    const actual = parseFloat(row.actualStock);
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
            {hasLargeDifference && (
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
                  <p className="text-xs text-slate-500 dark:text-slate-400">Oleh: {rec.staffName} {rec.pinVerified && <span className="text-green-600">✓ PIN Verified</span>}</p>
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

      <PinModal open={showPinModal} onClose={() => setShowPinModal(false)}
        onSuccess={() => { setShowPinModal(false); doSubmit(true); }}
        title="Verifikasi PIN Manager — Selisih Besar" />
      <ConfirmDialog open={showConfirm} onClose={() => setShowConfirm(false)}
        onConfirm={() => { setShowConfirm(false); doSubmit(false); }}
        title="Konfirmasi Stock Opname"
        message={isWarehouseStaff ? `Simpan hasil opname ${filledCount} item fisik? Data stok inventory akan diperbarui.` : `Simpan hasil opname ${filledCount} item? ${itemsWithDiff} item memiliki selisih. Stok di inventory akan diperbarui sesuai stok fisik.`} />
    </div>
  );
}
