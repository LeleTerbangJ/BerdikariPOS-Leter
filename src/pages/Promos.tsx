import { useState, useEffect } from 'react';
import { v4 as uuid } from 'uuid';
import { usePromoStore } from '../store/promoStore';
import { useMenuStore } from '../store/menuStore';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { formatRupiah } from '../utils/format';
import { validatePromoForm } from '../utils/promoValidation';
import type { Promo, PromoType, PromoScope } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  Plus,
  Pencil,
  Trash2,
  Tag,
  Percent,
  Calendar,
  Gift,
  Crown,
  Save,
} from 'lucide-react';

export default function Promos() {
  const { promos, addPromo, updatePromo, deletePromo, loyaltySettings, updateLoyaltySettings, loadFromCloud } = usePromoStore();
  const { getCategories, menus } = useMenuStore();

  // Real-time sync for promos
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const channelName = 'promos-rt-' + Math.random().toString(36).substring(2, 9);
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promos' }, () => {
        loadFromCloud(true);
      })
      .subscribe();
    return () => { try { supabase.removeChannel(channel); } catch (e) {} };
  }, []);

  const [activeSection, setActiveSection] = useState<'promos' | 'loyalty'>('promos');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formType, setFormType] = useState<PromoType>('percentage');
  const [formValue, setFormValue] = useState('');
  const [formScope, setFormScope] = useState<PromoScope>('all');
  const [formScopeTarget, setFormScopeTarget] = useState('');
  const [formMinPurchase, setFormMinPurchase] = useState('');
  const [formMaxDiscount, setFormMaxDiscount] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formUsageLimit, setFormUsageLimit] = useState('');
  const [formLoyaltyMinVisits, setFormLoyaltyMinVisits] = useState('');
  // v4.7 TO DO 12.2.5 (P-A5): BOGO & min-qty
  const [formBogoBuyQty, setFormBogoBuyQty] = useState('');
  const [formBogoFreeQty, setFormBogoFreeQty] = useState('');
  const [formBogoPercent, setFormBogoPercent] = useState('');
  const [formMinQty, setFormMinQty] = useState('');
  // v4.7 TO DO 12.2.6 (P-A6): batas pemakaian per pelanggan
  const [formUsageLimitPerCustomer, setFormUsageLimitPerCustomer] = useState('');
  // v4.7 TO DO 12.2.3 (P-A4): boleh digabung dengan diskon lain (manual/loyalty)
  const [formStackable, setFormStackable] = useState(true);
  // v4.7 TO DO 12.2 / P-A2: pesan validasi form (ditampilkan merah di modal)
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const categories = getCategories();

  const openAdd = () => {
    setEditId(null);
    setFormName(''); setFormCode(''); setFormType('percentage'); setFormValue('');
    setFormScope('all'); setFormScopeTarget(''); setFormMinPurchase('');
    setFormMaxDiscount(''); setFormStartDate(''); setFormEndDate('');
    setFormUsageLimit(''); setFormLoyaltyMinVisits('');
    setFormBogoBuyQty(''); setFormBogoFreeQty(''); setFormBogoPercent(''); setFormMinQty('');
    setFormUsageLimitPerCustomer('');
    setFormStackable(true);
    setFormErrors([]);
    setShowForm(true);
  };

  const openEdit = (p: Promo) => {
    setEditId(p.id);
    setFormName(p.name); setFormCode(p.code || ''); setFormType(p.type);
    setFormValue(String(p.value)); setFormScope(p.scope);
    setFormScopeTarget(p.scopeTarget || ''); setFormMinPurchase(String(p.minPurchase || ''));
    setFormMaxDiscount(String(p.maxDiscount || ''));
    setFormStartDate(p.startDate.split('T')[0]); setFormEndDate(p.endDate.split('T')[0]);
    setFormUsageLimit(String(p.usageLimit || '')); setFormLoyaltyMinVisits(String(p.loyaltyMinVisits || ''));
    setFormBogoBuyQty(String(p.bogoBuyQty || '')); setFormBogoFreeQty(String(p.bogoFreeQty || ''));
    setFormBogoPercent(String(p.bogoPercent ?? '')); setFormMinQty(String(p.minQty || ''));
    setFormUsageLimitPerCustomer(String(p.usageLimitPerCustomer || ''));
    setFormStackable(p.stackable !== false);
    setFormErrors([]);
    setShowForm(true);
  };

  const handleSave = () => {
    // v4.7 TO DO 12.2 / P-A2: validasi form sebelum simpan (nama, nilai, tanggal, target scope)
    const result = validatePromoForm({
      name: formName,
      type: formType,
      value: formType === 'bogo' ? 0 : (parseFloat(formValue) || 0),
      scope: formScope,
      scopeTarget: formScopeTarget || undefined,
      minPurchase: parseInt(formMinPurchase) || undefined,
      maxDiscount: parseInt(formMaxDiscount) || undefined,
      startDate: formStartDate,
      endDate: formEndDate,
      usageLimit: parseInt(formUsageLimit) || undefined,
      loyaltyMinVisits: parseInt(formLoyaltyMinVisits) || undefined,
      // P-A5: BOGO & min-qty
      bogoBuyQty: parseInt(formBogoBuyQty) || undefined,
      bogoFreeQty: parseInt(formBogoFreeQty) || undefined,
      bogoPercent: formBogoPercent !== '' ? (parseInt(formBogoPercent) || 0) : undefined,
      minQty: parseInt(formMinQty) || undefined,
      // P-A6: batas pemakaian per pelanggan
      usageLimitPerCustomer: parseInt(formUsageLimitPerCustomer) || undefined,
    });
    if (!result.valid) {
      setFormErrors(result.errors);
      return;
    }
    setFormErrors([]);

    const data: Omit<Promo, 'id' | 'usageCount' | 'createdAt'> = {
      name: formName,
      code: formCode || undefined,
      type: formType,
      // BOGO: value tidak dipakai (dihitung per item) — simpan 0 (kolom DB NOT NULL)
      value: formType === 'bogo' ? 0 : (parseFloat(formValue) || 0),
      scope: formScope,
      scopeTarget: formScopeTarget || undefined,
      minPurchase: parseInt(formMinPurchase) || undefined,
      maxDiscount: parseInt(formMaxDiscount) || undefined,
      startDate: new Date(formStartDate).toISOString(),
      endDate: new Date(formEndDate + 'T23:59:59').toISOString(),
      isActive: true,
      usageLimit: parseInt(formUsageLimit) || undefined,
      loyaltyMinVisits: parseInt(formLoyaltyMinVisits) || undefined,
      // v4.7 TO DO 12.2.3 (P-A4): default true — undefined = legacy tetap bisa digabung
      stackable: formStackable,
      // v4.7 TO DO 12.2.5 (P-A5): BOGO & min-qty
      bogoBuyQty: formType === 'bogo' ? (parseInt(formBogoBuyQty) || 2) : undefined,
      bogoFreeQty: formType === 'bogo' ? (parseInt(formBogoFreeQty) || 1) : undefined,
      bogoPercent: formType === 'bogo' && formBogoPercent !== '' ? (parseInt(formBogoPercent) || 0) : undefined,
      minQty: formType !== 'bogo' && formMinQty ? (parseInt(formMinQty) || undefined) : undefined,
      // v4.7 TO DO 12.2.6 (P-A6): batas pemakaian per pelanggan
      usageLimitPerCustomer: formUsageLimitPerCustomer ? (parseInt(formUsageLimitPerCustomer) || undefined) : undefined,
    };

    if (editId) {
      updatePromo(editId, data);
    } else {
      addPromo({ id: uuid(), ...data, usageCount: 0, createdAt: new Date().toISOString() });
    }
    setShowForm(false);
  };

  const isExpired = (p: Promo) => new Date(p.endDate) < new Date();
  const isUpcoming = (p: Promo) => new Date(p.startDate) > new Date();

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-center sm:text-left w-full sm:w-auto">🎁 Promo & Loyalty</h1>
        {activeSection === 'promos' && (
          <button onClick={openAdd} className="btn-primary text-sm w-full sm:w-auto flex items-center justify-center gap-1.5 py-2.5 px-4">
            <Plus size={16} /> Tambah Promo
          </button>
        )}
      </div>

      {/* Section Toggle */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-6">
        <button
          onClick={() => setActiveSection('promos')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition ${
            activeSection === 'promos' ? 'bg-white dark:bg-slate-700 shadow-sm text-brand-700 dark:text-brand-400 font-semibold' : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <Tag size={16} /> Promo & Voucher
        </button>
        <button
          onClick={() => setActiveSection('loyalty')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition ${
            activeSection === 'loyalty' ? 'bg-white dark:bg-slate-700 shadow-sm text-brand-700 dark:text-brand-400 font-semibold' : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <Crown size={16} /> Loyalty Member
        </button>
      </div>

      {/* Promos Section */}
      {activeSection === 'promos' && (
        <div className="space-y-4">

          {promos.length === 0 ? (
            <div className="card p-12 text-center text-slate-400">
              <Gift size={40} className="mx-auto mb-2 opacity-30" />
              <p>Belum ada promo</p>
            </div>
          ) : (
            <div className="space-y-3">
              {promos.map((p) => (
                <div key={p.id} className={`card p-4 ${isExpired(p) ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{p.name}</h3>
                        {p.code && <span className="badge bg-brand-100 text-brand-700 font-mono">{p.code}</span>}
                        {isExpired(p) && <span className="badge bg-red-100 text-red-700">Expired</span>}
                        {isUpcoming(p) && <span className="badge bg-blue-100 text-blue-700">Upcoming</span>}
                        {!isExpired(p) && !isUpcoming(p) && p.isActive && <span className="badge bg-green-100 text-green-700">Aktif</span>}
                      </div>
                      <p className="text-sm text-slate-600">
                        {p.type === 'bogo'
                          ? `Beli ${p.bogoBuyQty || 2} ${p.bogoPercent && p.bogoPercent > 0 ? `diskon ${p.bogoPercent}% utk ` : 'Gratis '}${p.bogoFreeQty || 1} item`
                          : p.type === 'percentage' ? `${p.value}%` : formatRupiah(p.value) + ' off'}
                        {p.scope === 'all' ? ' • Semua menu' : p.scope === 'category' ? ` • Kategori: ${p.scopeTarget}` : p.scope === 'loyalty' ? ` • Loyalty (min ${p.loyaltyMinVisits} visit)` : ` • Menu: ${menus.find((m) => m.id === p.scopeTarget)?.name || 'Menu tertentu'}`}
                        {p.minQty ? ` • Min ${p.minQty} item` : ''}
                        {p.usageLimitPerCustomer ? ` • Maks ${p.usageLimitPerCustomer}× per pelanggan` : ''}
                        {p.stackable === false && ' • Eksklusif (tidak digabung diskon lain)'}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        <Calendar size={11} className="inline mr-1" />
                        {new Date(p.startDate).toLocaleDateString('id-ID')} — {new Date(p.endDate).toLocaleDateString('id-ID')}
                        {p.usageLimit && ` • ${p.usageCount}/${p.usageLimit} digunakan`}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => updatePromo(p.id, { isActive: !p.isActive })}
                        className={`p-1.5 rounded-lg text-xs font-medium ${p.isActive ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}
                      >
                        {p.isActive ? 'ON' : 'OFF'}
                      </button>
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-slate-100">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => setDeleteId(p.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Loyalty Section */}
      {activeSection === 'loyalty' && (
        <div className="space-y-6">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Crown size={18} /> Pengaturan Loyalty Member
              </h2>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={loyaltySettings.enabled}
                  onChange={(e) => updateLoyaltySettings({ enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
              </label>
            </div>

            {loyaltySettings.enabled && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                    <p className="text-xs text-amber-600 font-medium">🥉 Bronze</p>
                    <div className="mt-2 space-y-2">
                      <div>
                        <label className="text-xs text-slate-500">Min. Kunjungan</label>
                        <input type="number" value={loyaltySettings.tierBronzeMinVisits} onChange={(e) => updateLoyaltySettings({ tierBronzeMinVisits: parseInt(e.target.value) || 0 })} className="input text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Diskon (%)</label>
                        <input type="number" value={loyaltySettings.tierBronzeDiscount} onChange={(e) => updateLoyaltySettings({ tierBronzeDiscount: parseInt(e.target.value) || 0 })} className="input text-sm" />
                      </div>
                    </div>
                  </div>
                  <div className="p-4 bg-slate-100 rounded-xl border border-slate-200">
                    <p className="text-xs text-slate-600 font-medium">🥈 Silver</p>
                    <div className="mt-2 space-y-2">
                      <div>
                        <label className="text-xs text-slate-500">Min. Kunjungan</label>
                        <input type="number" value={loyaltySettings.tierSilverMinVisits} onChange={(e) => updateLoyaltySettings({ tierSilverMinVisits: parseInt(e.target.value) || 0 })} className="input text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Diskon (%)</label>
                        <input type="number" value={loyaltySettings.tierSilverDiscount} onChange={(e) => updateLoyaltySettings({ tierSilverDiscount: parseInt(e.target.value) || 0 })} className="input text-sm" />
                      </div>
                    </div>
                  </div>
                  <div className="p-4 bg-yellow-50 rounded-xl border border-yellow-200">
                    <p className="text-xs text-yellow-700 font-medium">🥇 Gold</p>
                    <div className="mt-2 space-y-2">
                      <div>
                        <label className="text-xs text-slate-500">Min. Kunjungan</label>
                        <input type="number" value={loyaltySettings.tierGoldMinVisits} onChange={(e) => updateLoyaltySettings({ tierGoldMinVisits: parseInt(e.target.value) || 0 })} className="input text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Diskon (%)</label>
                        <input type="number" value={loyaltySettings.tierGoldDiscount} onChange={(e) => updateLoyaltySettings({ tierGoldDiscount: parseInt(e.target.value) || 0 })} className="input text-sm" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* v4.7 TO DO 12.2.2 (P-A8): konfigurasi poin loyalty — earn & redeem */}
                <div className="p-4 bg-purple-50 dark:bg-purple-950/30 rounded-xl border border-purple-200 dark:border-purple-900/40">
                  <p className="text-xs text-purple-700 dark:text-purple-300 font-semibold mb-3">⭐ Poin Loyalty — Earn &amp; Redeem</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs text-slate-500">Poin per Transaksi</label>
                      <input type="number" value={loyaltySettings.pointsPerTransaction} onChange={(e) => updateLoyaltySettings({ pointsPerTransaction: parseInt(e.target.value) || 0 })} className="input text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">1 Poin per Rp</label>
                      <input type="number" value={loyaltySettings.pointsPerRupiah} onChange={(e) => updateLoyaltySettings({ pointsPerRupiah: parseInt(e.target.value) || 0 })} className="input text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">1 Poin = Rp (diskon)</label>
                      <input type="number" value={loyaltySettings.redeemPointsValue} onChange={(e) => updateLoyaltySettings({ redeemPointsValue: parseInt(e.target.value) || 0 })} className="input text-sm" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    Poin otomatis didapat pelanggan saat checkout ({loyaltySettings.pointsPerTransaction} + total ÷ Rp {loyaltySettings.pointsPerRupiah})
                    dan bisa ditukar kasir jadi diskon di layar Bayar (1 poin = Rp {loyaltySettings.redeemPointsValue}).
                    Poin pelanggan tampil saat memilih pelanggan di POS.
                  </p>
                </div>

                <p className="text-xs text-slate-400">
                  Diskon loyalty otomatis diterapkan saat pelanggan dipilih di POS berdasarkan jumlah kunjungan mereka.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Promo Form Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editId ? 'Edit Promo' : 'Tambah Promo'} maxWidth="max-w-xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Nama Promo</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} className="input" placeholder="Promo Akhir Pekan" />
            </div>
            <div>
              <label className="label">Kode Voucher (opsional)</label>
              <input value={formCode} onChange={(e) => setFormCode(e.target.value.toUpperCase())} className="input font-mono" placeholder="WEEKEND20" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Tipe Diskon</label>
              <select value={formType} onChange={(e) => setFormType(e.target.value as PromoType)} className="input">
                <option value="percentage">Persentase (%)</option>
                <option value="fixed">Nominal Tetap (Rp)</option>
                <option value="bogo">BOGO / Beli N Gratis M (per item)</option>
              </select>
            </div>
            {formType !== 'bogo' ? (
              <div>
                <label className="label">Nilai {formType === 'percentage' ? '(%)' : '(Rp)'}</label>
                <input value={formValue} onChange={(e) => setFormValue(e.target.value)} className="input" type="number" />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label">Beli</label>
                  <input value={formBogoBuyQty} onChange={(e) => setFormBogoBuyQty(e.target.value.replace(/\D/g, ''))} className="input" type="number" placeholder="2" />
                </div>
                <div>
                  <label className="label">Gratis</label>
                  <input value={formBogoFreeQty} onChange={(e) => setFormBogoFreeQty(e.target.value.replace(/\D/g, ''))} className="input" type="number" placeholder="1" />
                </div>
                <div>
                  <label className="label">Diskon %</label>
                  <input value={formBogoPercent} onChange={(e) => setFormBogoPercent(e.target.value.replace(/\D/g, ''))} className="input" type="number" placeholder="0" />
                </div>
              </div>
            )}
          </div>
          {formType === 'bogo' && (
            <p className="text-xs text-slate-400">
              Contoh: Beli 2, Gratis 1 = gratis penuh 1 item termurah. Diskon % &gt; 0 = item gratis hanya
              dipotong sebagian (mis. 50 = item ke-N diskon 50%). Gratis selalu diambil dari item TERMURAH.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Berlaku Untuk</label>
              <select value={formScope} onChange={(e) => { setFormScope(e.target.value as PromoScope); setFormScopeTarget(''); }} className="input">
                <option value="all">Semua Menu</option>
                <option value="category">Kategori Tertentu</option>
                <option value="menu">Menu Tertentu</option>
                {formType !== 'bogo' && <option value="loyalty">Pelanggan Loyal</option>}
              </select>
            </div>
            {formScope === 'category' && (
              <div>
                <label className="label">Kategori</label>
                <select value={formScopeTarget} onChange={(e) => setFormScopeTarget(e.target.value)} className="input">
                  <option value="">Pilih kategori</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {formScope === 'menu' && (
              <div>
                <label className="label">Menu</label>
                <select value={formScopeTarget} onChange={(e) => setFormScopeTarget(e.target.value)} className="input">
                  <option value="">Pilih menu</option>
                  {menus.map((m) => <option key={m.id} value={m.id}>{m.name}{m.isBestSeller ? ' ⭐' : ''}</option>)}
                </select>
              </div>
            )}
            {formScope === 'loyalty' && (
              <div>
                <label className="label">Min. Kunjungan</label>
                <input value={formLoyaltyMinVisits} onChange={(e) => setFormLoyaltyMinVisits(e.target.value)} className="input" type="number" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Tanggal Mulai</label>
              <input type="date" value={formStartDate} onChange={(e) => setFormStartDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Tanggal Berakhir</label>
              <input type="date" value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} className="input" />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="label">Min. Belanja (Rp)</label>
              <input value={formMinPurchase} onChange={(e) => setFormMinPurchase(e.target.value)} className="input" type="number" placeholder="0" />
            </div>
            <div>
              <label className="label">Maks. Diskon (Rp)</label>
              <input value={formMaxDiscount} onChange={(e) => setFormMaxDiscount(e.target.value)} className="input" type="number" placeholder="Tanpa batas" />
            </div>
            <div>
              <label className="label">Batas Penggunaan</label>
              <input value={formUsageLimit} onChange={(e) => setFormUsageLimit(e.target.value)} className="input" type="number" placeholder="Unlimited" />
            </div>
            <div>
              <label className="label">Batas per Pelanggan (opsional)</label>
              <input value={formUsageLimitPerCustomer} onChange={(e) => setFormUsageLimitPerCustomer(e.target.value.replace(/\D/g, ''))} className="input" type="number" placeholder="Contoh: 1 = 1× per pelanggan" />
            </div>
          </div>

          <p className="text-xs text-slate-400 -mt-2">
            {formUsageLimitPerCustomer ? '⚠️ Promo ini mewajibkan pelanggan dipilih di POS (pemakaian dicatat per pelanggan).' : 'Batas per pelanggan: kosongkan bila semua pelanggan boleh memakai berulang kali.'}
          </p>

          {/* v4.7 TO DO 12.2.5 (P-A5): min-qty gate untuk diskon %/nominal */}
          {formType !== 'bogo' && (
            <div>
              <label className="label">Min. Qty Item (opsional)</label>
              <input value={formMinQty} onChange={(e) => setFormMinQty(e.target.value.replace(/\D/g, ''))} className="input" type="number" placeholder="Contoh: 3 = diskon hanya jika beli ≥ 3 item target" />
              <p className="text-xs text-slate-400 mt-1">
                Diskon hanya berlaku bila total qty item target (menu/kategori, atau seluruh keranjang
                untuk "Semua Menu") mencapai jumlah ini.
              </p>
            </div>
          )}

          {/* v4.7 TO DO 12.2.3 (P-A4): opsi stacking per promo */}
          <label className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={formStackable}
              onChange={(e) => setFormStackable(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-brand-600"
            />
            <div>
              <p className="text-sm font-medium">Boleh digabung dengan diskon lain (manual / loyalty)</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Jika dinonaktifkan, promo bersifat <b>eksklusif</b> — POS otomatis memberi diskon
                terbaik: pelanggan mendapat <b>promo ini</b> ATAU <b>diskon manual + loyalty</b>,
                tidak keduanya.
              </p>
            </div>
          </label>

          {formErrors.length > 0 && (
            <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl space-y-1">
              {formErrors.map((err) => (
                <p key={err} className="text-xs text-red-600 dark:text-red-400">⚠️ {err}</p>
              ))}
            </div>
          )}

          <div className="flex gap-3 pt-3 border-t border-slate-100">
            <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">Batal</button>
            <button onClick={handleSave} className="btn-primary flex-1" disabled={!formName || (formType !== 'bogo' && !formValue) || !formStartDate || !formEndDate}>
              {editId ? 'Simpan' : 'Tambah'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) deletePromo(deleteId); }}
        title="Hapus Promo"
        message="Yakin ingin menghapus promo ini?"
        confirmText="Ya, Hapus"
      />
    </div>
  );
}
