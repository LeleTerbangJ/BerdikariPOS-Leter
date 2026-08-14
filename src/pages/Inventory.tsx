import { useState, useEffect } from 'react';
import { useInventoryStore } from '../store/inventoryStore';
import { useStockOpnameStore } from '../store/stockOpnameStore';
import { useAuthStore } from '../store/authStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { subscribeToStockOpnames, unsubscribeChannel } from '../lib/cloudSync';
import { formatRupiah } from '../utils/format';
import type { ParsedImportRow } from '../utils/stockImport';
import type { InventoryItem } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import StockOpname from './StockOpname';
import { useToastStore } from '../store/toastStore';
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Package,
  AlertTriangle,
  Download,
  Upload,
  Settings2,
  ClipboardCheck,
  Warehouse,
  FileSpreadsheet,
} from 'lucide-react';

export default function Inventory() {
  // v4.7 TO DO 13.5 (O-7): potensi konflik stok lintas device
  const { items: inventory, addItem, updateItem, deleteItem, importItems, loadFromCloud, stockConflicts, clearStockConflicts } = useInventoryStore();
  const { currentUser } = useAuthStore();
  const { addLog } = useAuditLogStore();
  const [activeTab, setActiveTab] = useState<'inventory' | 'opname'>('inventory');

  // LOGIC-06 fix: Real-time sync for inventory and stock opnames
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const channelName = 'inv-page-rt-' + Math.random().toString(36).substring(2, 9);
    const invChannel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => {
        loadFromCloud(true);
      })
      .subscribe();

    const opnameChannel = subscribeToStockOpnames(() => {
      useStockOpnameStore.getState().loadFromCloud();
    });

    return () => {
      if (invChannel) try { supabase.removeChannel(invChannel); } catch (e) {}
      if (opnameChannel) unsubscribeChannel(opnameChannel);
    };
  }, []);

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'low'>('all');
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [deleteInvId, setDeleteInvId] = useState<string | null>(null);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [invName, setInvName] = useState('');
  const [invSlug, setInvSlug] = useState('');
  const [invStock, setInvStock] = useState('');
  const [invUnit, setInvUnit] = useState('kg');
  const [invCost, setInvCost] = useState('');
  const [invMinStock, setInvMinStock] = useState('3');

  // Bulk min stock setting
  const [showMinStockSetting, setShowMinStockSetting] = useState(false);
  const [globalMinStock, setGlobalMinStock] = useState('3');

  const filtered = inventory.filter((item) => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase()) || item.id.includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || item.stock < (item.minStock ?? 3);
    return matchSearch && matchStatus;
  });

  const lowStockCount = inventory.filter((i) => i.stock < (i.minStock ?? 3)).length;

  const openAdd = () => {
    setEditId(null);
    setInvName('');
    setInvSlug('');
    setInvStock('');
    setInvUnit('kg');
    setInvCost('');
    setInvMinStock('3');
    setShowForm(true);
  };

  const openEdit = (item: InventoryItem) => {
    setEditId(item.id);
    setInvName(item.name);
    setInvSlug(item.id);
    setInvStock(String(item.stock));
    setInvUnit(item.unit);
    setInvCost(String(item.costPerUnit));
    setInvMinStock(String(item.minStock ?? 3));
    setShowForm(true);
  };

  const handleSave = () => {
    const data = {
      name: invName,
      stock: parseFloat(invStock) || 0,
      unit: invUnit,
      costPerUnit: parseFloat(invCost) || 0,
      minStock: parseFloat(invMinStock) || 3,
    };
    if (editId) {
      updateItem(editId, data);
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'update_inventory', `Edit bahan baku: ${invName} (${invStock} ${invUnit})`, { itemId: editId });
      }
    } else {
      const slug = invSlug || invName.toLowerCase().replace(/\s+/g, '-');
      addItem({ id: slug, ...data });
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'create_inventory', `Tambah bahan baku: ${invName} (${invStock} ${invUnit})`, { itemId: slug });
      }
    }
    setShowForm(false);
  };

  const applyGlobalMinStock = () => {
    const val = parseFloat(globalMinStock) || 3;
    inventory.forEach((item) => {
      updateItem(item.id, { minStock: val });
    });
    if (currentUser) {
      addLog(currentUser.id, currentUser.name, currentUser.role, 'update_inventory', `Update min. stok semua bahan baku menjadi: ${val}`, { globalMinStock: val });
    }
    setShowMinStockSetting(false);
  };

  // CSV Export
  const handleExport = () => {
    const header = 'id,name,stock,unit,costPerUnit,minStock\n';
    const rows = inventory.map((i) =>
      [
        `"${i.id}"`,
        `"${i.name}"`,
        i.stock,
        `"${i.unit}"`,
        i.costPerUnit,
        i.minStock ?? 3,
      ].join(',')
    );
    const csv = header + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventaris-bahan-baku.csv';
    a.click();
  };

  const { addToast } = useToastStore();

  // Download CSV Template for Inventory
  const handleDownloadTemplate = () => {
    const header = 'ID,Nama Bahan,Stok,Satuan,Harga per Satuan,Min. Stok\n';
    const sampleRows = [
      'inv-sample-1,Kopi Arabika (Biji),1000,gram,300,200',
      'inv-sample-2,Susu UHT Fresh,10,liter,18000,2',
      'inv-sample-3,Gula Aren Cair,5000,ml,40,500',
      'inv-sample-4,Cup Plastik 16oz,100,pcs,500,20',
    ].join('\n');

    const csvContent = '\uFEFF' + header + sampleRows;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-import-bahan-baku.csv';
    a.click();
    URL.revokeObjectURL(url);
    addToast('Template CSV Bahan Baku berhasil diunduh', 'info');
  };

  // CSV Import
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').slice(1); // skip header
      // v4.7 TO DO 9.4: batch import — 1 setState + 1 syncInventoryStock bulk + log 'import' (9.1)
      const rows: ParsedImportRow[] = [];
      lines
        .filter((l) => l.trim())
        .forEach((line) => {
          const parts = line.match(/(".*?"|[^,]+)/g) || [];
          const clean = (s: string) => s.replace(/^"|"$/g, '');
          rows.push({
            id: clean(parts[0] || ''),
            name: clean(parts[1] || ''),
            stock: parseFloat(parts[2]) || 0,
            unit: clean(parts[3] || 'kg'),
            costPerUnit: parseFloat(parts[4]) || 0,
            minStock: parseFloat(parts[5]) || 3,
          });
        });
      if (rows.length > 0) {
        importItems(rows);
      }
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'update_inventory', `Import bahan baku dari CSV`);
      }
      addToast('Import bahan baku CSV berhasil!', 'success');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const totalValue = inventory.reduce((a, i) => a + i.stock * i.costPerUnit, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-center sm:text-left w-full sm:w-auto">📦 Inventaris</h1>
        <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
          <button onClick={openAdd} className="btn-primary text-sm flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto">
            <Plus size={16} /> Tambah Bahan
          </button>
          {currentUser?.role !== 'Staf Gudang' && (
            <button onClick={() => setShowMinStockSetting(true)} className="btn-secondary text-sm flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto">
              <Settings2 size={16} /> Min. Stok
            </button>
          )}
          <button onClick={handleExport} className="btn-secondary text-sm flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto">
            <Download size={16} /> Export
          </button>
          {currentUser?.role !== 'Staf Gudang' && (
            <>
              <button onClick={handleDownloadTemplate} title="Unduh Template CSV Import" className="btn-secondary text-sm flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto">
                <FileSpreadsheet size={16} /> Template CSV
              </button>
              <label className="btn-secondary text-sm cursor-pointer flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto">
                <Upload size={16} /> Import
                <input type="file" accept=".csv" onChange={handleImport} className="hidden" />
              </label>
            </>
          )}
        </div>
      </div>

      {/* v4.7 TO DO 13.5 (O-7): banner potensi konflik stok lintas device */}
      {stockConflicts.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <AlertTriangle size={16} /> Stok berubah di perangkat lain ({stockConflicts.length} bahan)
            </p>
            <button onClick={clearStockConflicts} className="btn-secondary text-xs px-2.5 py-1">
              Pahami
            </button>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Nilai cloud lebih tinggi dari stok lokal sebelum sinkron — bisa berarti deduksi dari perangkat ini tertimpa
            perangkat lain (dua kasir offline menjual bahan yang sama), atau ada penambahan/adjustment dari device lain.
            Periksa stok fisik sebelum meneruskan.
          </p>
          <div className="space-y-1">
            {stockConflicts.map((c) => (
              <div key={c.ingredientId} className="flex justify-between text-xs text-amber-700 dark:text-amber-400">
                <span>{c.name} ({c.unit})</span>
                <span>lokal {c.localBefore} → cloud {c.cloudNow} (+{Math.round(c.diff * 100) / 100})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
        <button onClick={() => setActiveTab('inventory')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition ${activeTab === 'inventory' ? 'bg-white dark:bg-slate-700 shadow-sm text-brand-700 dark:text-brand-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
          <Warehouse size={16} /> Bahan Baku
        </button>
        <button onClick={() => setActiveTab('opname')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition ${activeTab === 'opname' ? 'bg-white dark:bg-slate-700 shadow-sm text-brand-700 dark:text-brand-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
          <ClipboardCheck size={16} /> Stock Opname
        </button>
      </div>

      {activeTab === 'opname' && <StockOpname />}

      {activeTab === 'inventory' && (<>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <Package className="text-blue-600" size={20} />
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Item</p>
              <p className="text-lg font-bold">{inventory.length}</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="text-amber-600" size={20} />
            </div>
            <div>
              <p className="text-xs text-slate-500">Stok Rendah</p>
              <p className="text-lg font-bold text-amber-600">{lowStockCount}</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
              <Package className="text-green-600" size={20} />
            </div>
            <div>
              <p className="text-xs text-slate-500">Nilai Inventaris</p>
              <p className="text-lg font-bold text-green-700">{formatRupiah(totalValue)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Cari bahan..."
            className="input pl-9 text-sm"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value as 'all' | 'low'); setPage(1); }}
          className="input w-auto text-sm"
        >
          <option value="all">Semua Status</option>
          <option value="low">Stok Rendah</option>
        </select>
        <select
          value={perPage}
          onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
          className="input w-auto text-sm"
        >
          <option value={10}>10 / halaman</option>
          <option value={25}>25 / halaman</option>
          <option value={50}>50 / halaman</option>
          <option value={100}>100 / halaman</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-700">
              <tr>
                <th className="text-left p-3 font-semibold">ID</th>
                <th className="text-left p-3 font-semibold">Nama Bahan</th>
                <th className="text-right p-3 font-semibold">Stok</th>
                <th className="text-left p-3 font-semibold">Unit</th>
                <th className="text-right p-3 font-semibold">Harga/Unit</th>
                <th className="text-right p-3 font-semibold">Min. Stok</th>
                <th className="text-right p-3 font-semibold">Nilai</th>
                <th className="text-center p-3 font-semibold">Status</th>
                <th className="text-center p-3 font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice((page - 1) * perPage, page * perPage).map((item) => {
                const isLow = item.stock < (item.minStock ?? 3);
                return (
                  <tr key={item.id} className={`border-b border-slate-50 dark:border-slate-700/40 ${isLow ? 'bg-red-50/50 dark:bg-red-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}>
                    <td className="p-3 font-mono text-xs text-slate-400">{item.id}</td>
                    <td className="p-3 font-medium">{item.name}</td>
                    <td className="p-3 text-right font-medium">{item.stock}</td>
                    <td className="p-3 text-slate-500">{item.unit}</td>
                    <td className="p-3 text-right">{formatRupiah(item.costPerUnit)}</td>
                    <td className="p-3 text-right text-slate-500">{item.minStock ?? 3}</td>
                    <td className="p-3 text-right font-medium">{formatRupiah(item.stock * item.costPerUnit)}</td>
                    <td className="p-3 text-center">
                      {isLow ? (
                        <span className="badge bg-red-100 text-red-700">
                          <AlertTriangle size={11} /> Rendah
                        </span>
                      ) : (
                        <span className="badge bg-green-100 text-green-700">Aman</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg hover:bg-slate-100" title="Edit Bahan">
                          <Pencil size={14} />
                        </button>
                        {currentUser?.role !== 'Staf Gudang' && (
                          <button onClick={() => setDeleteInvId(item.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Hapus Bahan">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {Math.ceil(filtered.length / perPage) > 1 && (
          <div className="flex items-center justify-between p-3 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              Menampilkan {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} dari {filtered.length}
            </p>
            <div className="flex gap-1">
              {Array.from({ length: Math.ceil(filtered.length / perPage) }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i + 1)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium ${
                    page === i + 1 ? 'bg-brand-600 text-white' : 'hover:bg-slate-100'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Form Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editId ? 'Edit Bahan' : 'Tambah Bahan'}>
        <div className="space-y-4">
          <div>
            <label className="label">Nama Bahan</label>
            <input value={invName} onChange={(e) => setInvName(e.target.value)} className="input" />
          </div>
          {!editId && (
            <div>
              <label className="label">ID (slug)</label>
              <input value={invSlug} onChange={(e) => setInvSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))} className="input font-mono" placeholder="contoh: kunyit-segar" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Stok</label>
              <input value={invStock} onChange={(e) => setInvStock(e.target.value)} className="input" type="number" step="0.1" />
            </div>
            <div>
              <label className="label">Unit</label>
              <select value={invUnit} onChange={(e) => setInvUnit(e.target.value)} className="input">
                <option value="kg">kg</option>
                <option value="L">L</option>
                <option value="pcs">pcs</option>
                <option value="ml">ml</option>
                <option value="g">g</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Harga per Unit (Rp)</label>
              <input value={invCost} onChange={(e) => setInvCost(e.target.value)} className="input" type="number" />
            </div>
            <div>
              <label className="label">Min. Stok (Peringatan)</label>
              <input value={invMinStock} onChange={(e) => setInvMinStock(e.target.value)} className="input" type="number" />
            </div>
          </div>
          <div className="flex gap-3 pt-3 border-t border-slate-100">
            <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">Batal</button>
            <button onClick={handleSave} className="btn-primary flex-1" disabled={!invName}>
              {editId ? 'Simpan' : 'Tambah'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Min Stock Setting Modal */}
      <Modal open={showMinStockSetting} onClose={() => setShowMinStockSetting(false)} title="Pengaturan Min. Stok" maxWidth="max-w-sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Atur batas minimum stok untuk semua bahan baku. Bahan dengan stok di bawah nilai ini akan ditandai sebagai "Stok Rendah".
          </p>
          <div>
            <label className="label">Minimum Stok (berlaku untuk semua)</label>
            <input
              value={globalMinStock}
              onChange={(e) => setGlobalMinStock(e.target.value)}
              className="input"
              type="number"
              step="0.5"
              min="0"
            />
          </div>
          <p className="text-xs text-slate-400">
            Catatan: Anda juga bisa mengatur min. stok per item saat mengedit bahan.
          </p>
          <div className="flex gap-3 pt-3 border-t border-slate-100">
            <button onClick={() => setShowMinStockSetting(false)} className="btn-secondary flex-1">Batal</button>
            <button onClick={applyGlobalMinStock} className="btn-primary flex-1">
              Terapkan ke Semua
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Delete */}
      <ConfirmDialog
        open={!!deleteInvId}
        onClose={() => setDeleteInvId(null)}
        onConfirm={() => {
          if (deleteInvId) {
            const item = inventory.find((i) => i.id === deleteInvId);
            const itemName = item?.name || '';
            deleteItem(deleteInvId);
            if (currentUser) {
              addLog(currentUser.id, currentUser.name, currentUser.role, 'delete_inventory', `Hapus bahan baku: ${itemName}`, { itemId: deleteInvId });
            }
          }
        }}
        title="Hapus Bahan"
        message="Yakin ingin menghapus bahan baku ini?"
        confirmText="Ya, Hapus"
      />
      </>)}
    </div>
  );
}
