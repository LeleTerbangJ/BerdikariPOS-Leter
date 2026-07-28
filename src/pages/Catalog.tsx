import { useState, useMemo, useEffect } from 'react';
import { v4 as uuid } from 'uuid';
import { useMenuStore } from '../store/menuStore';
import { useInventoryStore } from '../store/inventoryStore';
import { useAuthStore } from '../store/authStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { useSettingsStore } from '../store/settingsStore';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { formatRupiah } from '../utils/format';
import { calculateMenuHPP } from '../utils/hpp';
import { processAndUploadMenuImage } from '../utils/imageUpload';
import type { Menu, AddOn } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToastStore } from '../store/toastStore';
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Download,
  Upload,
  X,
  Tag,
  ToggleLeft,
  ToggleRight,
  FileSpreadsheet,
} from 'lucide-react';

export default function Catalog() {
  const { menus, addMenu, updateMenu, deleteMenu, importMenus, getCategories, customCategories, addCategory, deleteCategory, loadFromCloud } = useMenuStore();
  const { items: inventory } = useInventoryStore();
  const { currentUser } = useAuthStore();
  const { addLog } = useAuditLogStore();
  const settings = useSettingsStore((s) => s.settings);

  const configuredKitchenTargets = useMemo(() => {
    const targets = new Set<string>();
    if (settings.kitchenPrinters) {
      settings.kitchenPrinters.forEach((kp) => {
        if (kp.targetCategory) targets.add(kp.targetCategory);
      });
    }
    targets.add('Makanan');
    targets.add('Minuman');
    return Array.from(targets);
  }, [settings.kitchenPrinters]);

  // Real-time sync for menus
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const channel = supabase
      .channel('menus-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menus' }, () => {
        loadFromCloud(true);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('Semua');
  const [page, setPage] = useState(1);
  const perPage = 10;

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fabOpen, setFabOpen] = useState(false);

  // Category management
  const [showCatManager, setShowCatManager] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [deleteMenuId, setDeleteMenuId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formBestSeller, setFormBestSeller] = useState(false);
  const [formImage, setFormImage] = useState('');
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [formIngredients, setFormIngredients] = useState<{ invId: string; amount: string }[]>([]);
  const [formAddons, setFormAddons] = useState<{ name: string; price: string }[]>([]);
  const [formManualHpp, setFormManualHpp] = useState('');
  const [formKitchenTarget, setFormKitchenTarget] = useState('');
  const [formShowSugarLevel, setFormShowSugarLevel] = useState(true);
  const [formShowTemperature, setFormShowTemperature] = useState(true);

  const allCategories = getCategories();
  const filterCategories = ['Semua', ...allCategories];

  const filtered = useMemo(() => {
    let list = menus;
    if (filterCat !== 'Semua') list = list.filter((m) => m.category === filterCat);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q));
    }
    return list;
  }, [menus, filterCat, search]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const openAdd = () => {
    setEditId(null);
    setFormName('');
    setFormCategory(allCategories[0] || '');
    setFormPrice('');
    setFormBestSeller(false);
    setFormImage('');
    setFormIngredients([]);
    setFormAddons([]);
    setFormManualHpp('');
    setFormKitchenTarget('');
    setFormShowSugarLevel(true);
    setFormShowTemperature(true);
    setShowForm(true);
  };

  const openEdit = (menu: Menu) => {
    setEditId(menu.id);
    setFormName(menu.name);
    setFormCategory(menu.category);
    setFormPrice(String(menu.price));
    setFormBestSeller(menu.isBestSeller || false);
    setFormImage(menu.image || '');
    setFormIngredients(
      Object.entries(menu.ingredients).map(([invId, amount]) => ({
        invId,
        amount: String(amount),
      }))
    );
    setFormAddons(
      menu.availableAddons.map((a) => ({ name: a.name, price: String(a.price) }))
    );
    setFormManualHpp(menu.manualHpp ? String(menu.manualHpp) : '');
    setFormKitchenTarget(menu.kitchenTarget || '');
    setFormShowSugarLevel(menu.showSugarLevel !== false);
    setFormShowTemperature(menu.showTemperature !== false);
    setShowForm(true);
  };

  const handleSave = () => {
    const ingredients: Record<string, number> = {};
    formIngredients.forEach((i) => {
      if (i.invId && parseFloat(i.amount)) ingredients[i.invId] = parseFloat(i.amount);
    });
    const addons: AddOn[] = formAddons
      .filter((a) => a.name && parseInt(a.price))
      .map((a) => ({ name: a.name, price: parseInt(a.price) }));

    const data: Omit<Menu, 'id'> = {
      name: formName,
      category: formCategory,
      price: parseInt(formPrice) || 0,
      isBestSeller: formBestSeller,
      image: formImage || undefined,
      ingredients,
      availableAddons: addons,
      manualHpp: Object.keys(ingredients).length > 0 ? 0 : (parseInt(formManualHpp) || 0),
      kitchenTarget: formKitchenTarget || undefined,
      showSugarLevel: formShowSugarLevel,
      showTemperature: formShowTemperature,
    };

    if (editId) {
      updateMenu(editId, data);
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'update_menu', `Edit menu: ${formName}`, { menuId: editId });
      }
    } else {
      const newId = uuid();
      addMenu({ id: newId, ...data });
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'create_menu', `Tambah menu: ${formName}`, { menuId: newId });
      }
    }
    setShowForm(false);
  };

  const handleAddCategory = () => {
    if (newCatName.trim()) {
      addCategory(newCatName.trim());
      setNewCatName('');
    }
  };

  // CSV Export
  const handleExport = () => {
    const header = 'name,category,price,isBestSeller,ingredients,addons,manualHpp,kitchenTarget,showSugarLevel,showTemperature\n';
    const rows = menus.map((m) =>
      [
        `"${m.name}"`,
        `"${m.category}"`,
        m.price,
        m.isBestSeller || false,
        `"${JSON.stringify(m.ingredients)}"`,
        `"${JSON.stringify(m.availableAddons)}"`,
        m.manualHpp || 0,
        m.kitchenTarget || '',
        m.showSugarLevel !== false,
        m.showTemperature !== false,
      ].join(',')
    );
    const csv = header + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'menu-catalog.csv';
    a.click();
  };

  const { addToast } = useToastStore();

  // Download CSV Template for Catalog Menu
  const handleDownloadTemplate = () => {
    const header = 'Nama Menu,Kategori,Harga Jual,Best Seller (true/false),Bahan Baku (JSON),Addons (JSON),HPP Manual,Target Dapur,Pilihan Gula (true/false),Pilihan Suhu (true/false)\n';
    const sampleRows = [
      'Kopi Susu Gula Aren,Signature,18000,true,"{""inv-sample-1"":18,""inv-sample-2"":0.1,""inv-sample-3"":25}","[{""name"":""Extra Shot"",""price"":4000}]",0,Bar,true,true',
      'Americano,Coffee,15000,false,"{""inv-sample-1"":18}","[]",0,Bar,true,true',
      'Roti Bakar Cokelat,Makanan,12000,false,"{}","[]",5000,Dapur Makanan,false,false',
    ].join('\n');

    const csvContent = '\uFEFF' + header + sampleRows;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-import-katalog-menu.csv';
    a.click();
    URL.revokeObjectURL(url);
    addToast('Template CSV Katalog Menu berhasil diunduh', 'info');
  };

  // CSV Import
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').slice(1);
      const imported: Menu[] = lines
          .filter((l) => l.trim())
          .map((line) => {
            const parts = line.match(/(".*?"|[^,]+)/g) || [];
            const clean = (s: string) => s.replace(/^"|"$/g, '');
            return {
              id: uuid(),
              name: clean(parts[0] || ''),
              category: clean(parts[1] || ''),
              price: parseInt(parts[2]) || 0,
              isBestSeller: parts[3] === 'true',
              ingredients: JSON.parse(clean(parts[4] || '{}')),
              availableAddons: JSON.parse(clean(parts[5] || '[]')),
              manualHpp: parseInt(parts[6]) || 0,
              kitchenTarget: parts[7] ? clean(parts[7]) : undefined,
              showSugarLevel: parts[8] ? clean(parts[8]) !== 'false' : true,
              showTemperature: parts[9] ? clean(parts[9]) !== 'false' : true,
            };
          });
      importMenus(imported);
      addToast('Import katalog menu CSV berhasil!', 'success');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-center sm:text-left w-full sm:w-auto">📦 Katalog Menu</h1>
        <div className="flex items-center justify-center sm:justify-end gap-2 w-full sm:w-auto flex-wrap">
          <button onClick={handleExport} className="btn-secondary text-sm flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto">
            <Download size={16} /> Export CSV
          </button>
          <button onClick={handleDownloadTemplate} title="Unduh Template CSV Import Menu" className="btn-secondary text-sm flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto">
            <FileSpreadsheet size={16} /> Template CSV
          </button>
          <label className="btn-secondary text-sm cursor-pointer flex items-center justify-center gap-1.5 py-2 px-3 w-full sm:w-auto">
            <Upload size={16} /> Import CSV
            <input type="file" accept=".csv" onChange={handleImport} className="hidden" />
          </label>
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
            placeholder="Cari menu..."
            className="input pl-9 text-sm"
          />
        </div>
        <select
          value={filterCat}
          onChange={(e) => { setFilterCat(e.target.value); setPage(1); }}
          className="input w-auto text-sm"
        >
          {filterCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-700">
              <tr>
                <th className="text-left p-3 font-semibold">Nama</th>
                <th className="text-left p-3 font-semibold">Kategori</th>
                <th className="text-left p-3 font-semibold">Target Dapur</th>
                <th className="text-right p-3 font-semibold">Harga</th>
                <th className="text-right p-3 font-semibold">HPP</th>
                <th className="text-right p-3 font-semibold">Margin</th>
                <th className="text-center p-3 font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((menu) => {
                const hpp = calculateMenuHPP(menu, inventory);
                const margin = menu.price - hpp;
                return (
                  <tr key={menu.id} className="border-b border-slate-50 dark:border-slate-700/40 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="p-3 font-medium">
                      {menu.name}
                      {menu.isBestSeller && <span className="ml-2 text-amber-500">⭐</span>}
                      {menu.isAvailable === false && <span className="ml-2 badge bg-slate-100 text-slate-500 text-xs">Nonaktif</span>}
                    </td>
                    <td className="p-3 text-slate-500 dark:text-slate-400">{menu.category}</td>
                    <td className="p-3 text-slate-500 dark:text-slate-400">
                      {menu.kitchenTarget ? (
                        <span className="badge bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-semibold px-2 py-0.5 rounded border border-indigo-100 dark:border-indigo-800/40">
                          {menu.kitchenTarget}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="p-3 text-right font-medium">{formatRupiah(menu.price)}</td>
                    <td className="p-3 text-right text-slate-500 dark:text-slate-400">{formatRupiah(hpp)}</td>
                    <td className="p-3 text-right text-green-600 font-medium">{formatRupiah(margin)}</td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => {
                            updateMenu(menu.id, { isAvailable: menu.isAvailable === false ? true : false });
                            if (currentUser) {
                              addLog(currentUser.id, currentUser.name, currentUser.role, 'toggle_menu', `${menu.isAvailable === false ? 'Aktifkan' : 'Nonaktifkan'} menu: ${menu.name}`, { menuId: menu.id });
                            }
                          }}
                          className={`p-1.5 rounded-lg ${menu.isAvailable === false ? 'text-slate-400 hover:bg-slate-100' : 'text-green-600 hover:bg-green-50'}`}
                          title={menu.isAvailable === false ? 'Aktifkan' : 'Nonaktifkan'}
                        >
                          {menu.isAvailable === false ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
                        </button>
                        <button onClick={() => openEdit(menu)} className="p-1.5 rounded-lg hover:bg-slate-100">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeleteMenuId(menu.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 p-3 border-t border-slate-100">
            {Array.from({ length: totalPages }, (_, i) => (
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
        )}
      </div>

      {/* Add/Edit Menu Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? 'Edit Menu' : 'Tambah Menu'}
        maxWidth="max-w-xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Nama Menu</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Kategori</label>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="input"
              >
                <option value="">-- Pilih Kategori --</option>
                {allCategories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Harga Jual (Rp)</label>
              <input value={formPrice} onChange={(e) => setFormPrice(e.target.value.replace(/\D/g, ''))} className="input" />
            </div>
            <div>
              <label className="label">Target Dapur (Split Print)</label>
              <select
                value={formKitchenTarget}
                onChange={(e) => setFormKitchenTarget(e.target.value)}
                className="input"
              >
                <option value="">Sama dengan Kasir (Tanpa Split)</option>
                {configuredKitchenTargets.map((target) => (
                  <option key={target} value={target}>{target}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-4 h-full pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formBestSeller} onChange={(e) => setFormBestSeller(e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-sm font-medium">Best Seller ⭐</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formShowSugarLevel} onChange={(e) => setFormShowSugarLevel(e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-350">Level Gula 🍬</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formShowTemperature} onChange={(e) => setFormShowTemperature(e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-350">Pilihan Suhu 🌡️</span>
              </label>
            </div>
          </div>

          {/* Image Upload */}
          <div>
            <label className="label">Foto Produk (opsional)</label>
            <div className="flex items-center gap-3">
              {formImage && (
                <img src={formImage} alt="Preview" className="w-16 h-16 rounded-xl object-cover border border-slate-200" />
              )}
              <label className={`btn-secondary text-xs cursor-pointer ${isUploadingImage ? 'opacity-50 pointer-events-none' : ''}`}>
                {isUploadingImage ? 'Memproses Foto...' : formImage ? 'Ganti Foto' : 'Upload Foto'}
                <input
                  type="file"
                  accept="image/*"
                  disabled={isUploadingImage}
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setIsUploadingImage(true);
                      const imageUrl = await processAndUploadMenuImage(file);
                      setFormImage(imageUrl);
                    } catch (err) {
                      alert('Gagal memproses foto produk');
                    } finally {
                      setIsUploadingImage(false);
                      e.target.value = '';
                    }
                  }}
                />
              </label>
              {formImage && !isUploadingImage && (
                <button onClick={() => setFormImage('')} className="text-xs text-red-500 hover:underline">Hapus</button>
              )}
            </div>
          </div>

          {/* Ingredients */}
          <div>
            <label className="label">Komposisi Bahan (Opsional)</label>
            {formIngredients.map((ing, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <select
                  value={ing.invId}
                  onChange={(e) => {
                    const arr = [...formIngredients];
                    arr[idx].invId = e.target.value;
                    setFormIngredients(arr);
                  }}
                  className="input flex-1"
                >
                  <option value="">Pilih bahan</option>
                  {inventory.map((inv) => (
                    <option key={inv.id} value={inv.id}>{inv.name} ({inv.unit})</option>
                  ))}
                </select>
                <input
                  value={ing.amount}
                  onChange={(e) => {
                    const arr = [...formIngredients];
                    arr[idx].amount = e.target.value;
                    setFormIngredients(arr);
                  }}
                  placeholder="Jumlah"
                  className="input w-24"
                />
                <button onClick={() => setFormIngredients(formIngredients.filter((_, i) => i !== idx))} className="p-2 text-red-400">
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setFormIngredients([...formIngredients, { invId: '', amount: '' }])}
              className="btn-ghost text-xs text-brand-600"
            >
              <Plus size={14} /> Tambah Bahan
            </button>
          </div>

          {/* HPP Manual (Only visible if no ingredients are added) */}
          {formIngredients.length === 0 ? (
            <div>
              <label className="label">HPP Manual (Rp)</label>
              <input
                value={formManualHpp}
                onChange={(e) => setFormManualHpp(e.target.value.replace(/\D/g, ''))}
                placeholder="Masukkan HPP untuk produk jadi (misal: Air Mineral)"
                className="input"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Gunakan HPP Manual jika produk tidak diproduksi dari komposisi bahan baku.
              </span>
            </div>
          ) : (
            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">HPP Terhitung (dari Komposisi):</span>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                {formatRupiah(
                  formIngredients.reduce((total, ing) => {
                    const item = inventory.find((i) => i.id === ing.invId);
                    return total + (item ? item.costPerUnit * (parseFloat(ing.amount) || 0) : 0);
                  }, 0)
                )}
              </p>
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                HPP Manual dinonaktifkan karena komposisi bahan digunakan.
              </span>
            </div>
          )}

          {/* Add-ons */}
          <div>
            <label className="label">Add-ons</label>
            {formAddons.map((addon, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <input
                  value={addon.name}
                  onChange={(e) => {
                    const arr = [...formAddons];
                    arr[idx].name = e.target.value;
                    setFormAddons(arr);
                  }}
                  placeholder="Nama addon"
                  className="input flex-1"
                />
                <input
                  value={addon.price}
                  onChange={(e) => {
                    const arr = [...formAddons];
                    arr[idx].price = e.target.value.replace(/\D/g, '');
                    setFormAddons(arr);
                  }}
                  placeholder="Harga"
                  className="input w-28"
                />
                <button onClick={() => setFormAddons(formAddons.filter((_, i) => i !== idx))} className="p-2 text-red-400">
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setFormAddons([...formAddons, { name: '', price: '' }])}
              className="btn-ghost text-xs text-brand-600"
            >
              <Plus size={14} /> Tambah Add-on
            </button>
          </div>



          <div className="flex gap-3 pt-3 border-t border-slate-100">
            <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">Batal</button>
            <button onClick={handleSave} className="btn-primary flex-1" disabled={!formName || !formPrice || !formCategory}>
              {editId ? 'Simpan' : 'Tambah'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Category Manager Modal */}
      <Modal
        open={showCatManager}
        onClose={() => setShowCatManager(false)}
        title="Kelola Kategori"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
              placeholder="Nama kategori baru"
              className="input flex-1"
              autoFocus
            />
            <button onClick={handleAddCategory} className="btn-primary" disabled={!newCatName.trim()}>
              <Plus size={16} /> Tambah
            </button>
          </div>

          <div className="space-y-2">
            {customCategories.map((cat) => {
              const menuCount = menus.filter((m) => m.category === cat).length;
              return (
                <div key={cat} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                  <div>
                    <span className="font-medium text-sm">{cat}</span>
                    <span className="text-xs text-slate-400 ml-2">({menuCount} menu)</span>
                  </div>
                  <button
                    onClick={() => deleteCategory(cat)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"
                    title="Hapus kategori"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
            {customCategories.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">Belum ada kategori</p>
            )}
          </div>
        </div>
      </Modal>

      {/* Confirm Delete */}
      <ConfirmDialog
        open={!!deleteMenuId}
        onClose={() => setDeleteMenuId(null)}
        onConfirm={() => {
          if (deleteMenuId) {
            const menuName = menus.find(m => m.id === deleteMenuId)?.name || '';
            deleteMenu(deleteMenuId);
            if (currentUser) {
              addLog(currentUser.id, currentUser.name, currentUser.role, 'delete_menu', `Hapus menu: ${menuName}`, { menuId: deleteMenuId });
            }
          }
        }}
        title="Hapus Menu"
        message="Yakin ingin menghapus menu ini? Tindakan ini tidak bisa dibatalkan."
        confirmText="Ya, Hapus"
      />

      {/* Floating Action Button (FAB) Speed Dial */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
        {/* Speed Dial Options */}
        {fabOpen && (
          <div className="flex flex-col items-end gap-2.5 animate-in fade-in slide-in-from-bottom-3 duration-200">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-slate-900/30 backdrop-blur-[1px] -z-10"
              onClick={() => setFabOpen(false)}
            />

            {/* Tambah Menu */}
            <button
              onClick={() => {
                setFabOpen(false);
                openAdd();
              }}
              className="btn bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 transition-transform hover:scale-105 active:scale-95 border border-white/20"
            >
              <Plus size={18} /> Tambah Menu
            </button>

            {/* Kelola Kategori */}
            <button
              onClick={() => {
                setFabOpen(false);
                setShowCatManager(true);
              }}
              className="btn bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white font-semibold text-xs px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 transition-transform hover:scale-105 active:scale-95 border border-white/20"
            >
              <Tag size={18} /> Kelola Kategori
            </button>
          </div>
        )}

        {/* Main Floating Button */}
        <button
          onClick={() => setFabOpen(!fabOpen)}
          className={`w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-white transition-all duration-300 active:scale-95 border border-white/20 ${
            fabOpen
              ? 'bg-slate-800 dark:bg-slate-700 rotate-45 scale-105 ring-4 ring-slate-400/30'
              : 'bg-brand-600 hover:bg-brand-700 hover:scale-105 ring-4 ring-brand-500/20'
          }`}
          title={fabOpen ? 'Tutup' : 'Aksi Katalog'}
        >
          <Plus size={28} />
        </button>
      </div>
    </div>
  );
}
