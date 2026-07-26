import { useState, useRef, useEffect } from 'react';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { useShiftStore } from '../store/shiftStore';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { connectBluetoothPrinter, disconnectBluetoothPrinter, isBluetoothConnected, CASHIER_PRINTER_ID, getBluetoothStatus, getDuplicateDeviceInfo, testPrintBluetooth } from '../utils/printer';
import { resetToDefault, clearOperationalData, factoryReset } from '../utils/dataManager';
import type { User, Role } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatRupiah } from '../utils/format';
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  Key,
  Save,
  Store,
  ImagePlus,
  X,
  Printer,
  RotateCcw,
  Database,
  AlertTriangle,
  Palette,
  FileText,
  Upload,
  Percent,
  Receipt,
} from 'lucide-react';
import { generateShades, THEME_PRESETS, hexToRgbValues } from '../utils/theme';

export default function SettingsPage() {
  const { users, addUser, updateUser, deleteUser, currentUser, loadFromCloud: loadUsersFromCloud } = useAuthStore();
  const { settings, updateSettings } = useSettingsStore();
  const { addLog } = useAuditLogStore();
  const { shifts } = useShiftStore();

  // Real-time sync for users
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const channel = supabase
      .channel('settings-users-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        loadUsersFromCloud(true);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Store settings
  const [storeName, setStoreName] = useState(settings.storeName);
  const [storeAddress, setStoreAddress] = useState(settings.address || '');
  const [storeLogo, setStoreLogo] = useState(settings.storeLogo || '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tax settings state
  const [taxEnabled, setTaxEnabled] = useState<boolean>(
    settings.taxEnabled ?? (settings.taxPercent ? settings.taxPercent > 0 : false)
  );
  const [taxPercentInput, setTaxPercentInput] = useState<string>(
    String(settings.taxPercent !== undefined ? settings.taxPercent : 0)
  );

  const saveTaxSettings = () => {
    const val = parseFloat(taxPercentInput) || 0;
    if (val < 0 || val > 100) {
      alert('Persentase pajak harus di antara 0% dan 100%');
      return;
    }
    updateSettings({
      taxEnabled,
      taxPercent: val,
    });
    if (currentUser) {
      addLog(
        currentUser.id,
        currentUser.name,
        currentUser.role,
        'update_settings',
        `Update pengaturan pajak: Status=${taxEnabled ? 'Aktif' : 'Nonaktif'}, Persentase=${val}%`
      );
    }
    alert('Pengaturan pajak berhasil disimpan! 🎉');
  };

  // UI Theme Settings
  const [themeColor, setThemeColor] = useState(settings.themeColor || '#b85f21');
  const [themeShades, setThemeShades] = useState<Record<string, string>>(
    (settings.themeShades && Object.keys(settings.themeShades).length > 0)
      ? (settings.themeShades as any)
      : {
          50: '#fdf8f3',
          100: '#f9ebd9',
          200: '#f2d4ae',
          300: '#e9b67a',
          400: '#de9348',
          500: '#d17a2a',
          600: '#b85f21',
          700: '#94481f',
          800: '#763b20',
          900: '#60311d',
        }
  );

  const applyPreset = (preset: typeof THEME_PRESETS[0]) => {
    setThemeColor(preset.color);
    setThemeShades(preset.shades as any);
  };

  const handleAutoGenerateShades = (color: string) => {
    const generated = generateShades(color);
    setThemeShades(generated);
  };

  const handleShadeChange = (shade: string, value: string) => {
    setThemeShades((prev) => ({
      ...prev,
      [shade]: value,
    }));
  };

  const saveThemeSettings = () => {
    updateSettings({
      themeColor,
      themeShades: themeShades as any,
    });
    alert('Tema warna UI berhasil disimpan!');
  };

  // Apply local state themeShades instantly to the root for live preview
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(themeShades).forEach(([shade, hex]) => {
      try {
        const rgbStr = hexToRgbValues(hex);
        root.style.setProperty(`--brand-${shade}`, rgbStr);
      } catch (err) {
        console.error('Failed to set preview root property:', err);
      }
    });
  }, [themeShades]);

  // Revert preview on unmount if changes were not saved
  useEffect(() => {
    return () => {
      const stateShades = useSettingsStore.getState().settings.themeShades;
      const activeShades = (stateShades && Object.keys(stateShades).length > 0)
        ? stateShades
        : {
            50: '#fdf8f3',
            100: '#f9ebd9',
            200: '#f2d4ae',
            300: '#e9b67a',
            400: '#de9348',
            500: '#d17a2a',
            600: '#b85f21',
            700: '#94481f',
            800: '#763b20',
            900: '#60311d',
          };
      const root = document.documentElement;
      Object.entries(activeShades).forEach(([shade, hex]) => {
        try {
          const rgbStr = hexToRgbValues(hex);
          root.style.setProperty(`--brand-${shade}`, rgbStr);
        } catch (err) {
          // ignore
        }
      });
    };
  }, []);

  // User form
  const [showUserForm, setShowUserForm] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [userUsername, setUserUsername] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userRole, setUserRole] = useState<Role>('Kasir');

  // PIN — BUG-NEW-02 fix: always start empty to avoid showing bcrypt hash
  const [pin, setPin] = useState('');

  // Data management confirm dialogs
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showFactoryConfirm, setShowFactoryConfirm] = useState(false);
  // Super Admin access
  const [superAdminUnlocked, setSuperAdminUnlocked] = useState(false);
  const [superPinInput, setSuperPinInput] = useState('');
  const [superPinError, setSuperPinError] = useState('');
  const [newSuperPin, setNewSuperPin] = useState('');
  const [activeTab, setActiveTab] = useState<'general' | 'printers' | 'users'>('general');

  // Table settings local state
  const [newTableInput, setNewTableInput] = useState('');

  const handleAddTable = () => {
    if (!newTableInput.trim()) return;
    const currentTables = settings.availableTableNumbers || [];
    if (currentTables.includes(newTableInput.trim())) {
      alert('Nomor meja tersebut sudah terdaftar.');
      return;
    }
    const updated = [...currentTables, newTableInput.trim()];
    updateSettings({ availableTableNumbers: updated });
    setNewTableInput('');
    if (currentUser) {
      addLog(currentUser.id, currentUser.name, currentUser.role, 'update_settings', `Tambah nomor meja: ${newTableInput.trim()}`);
    }
  };

  const handleRemoveTable = (table: string) => {
    const currentTables = settings.availableTableNumbers || [];
    const updated = currentTables.filter((t) => t !== table);
    updateSettings({ availableTableNumbers: updated });
    if (currentUser) {
      addLog(currentUser.id, currentUser.name, currentUser.role, 'update_settings', `Hapus nomor meja: ${table}`);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      alert('Ukuran file maksimal 500KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setStoreLogo(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const saveStoreSettings = () => {
    updateSettings({
      storeName,
      address: storeAddress,
      storeLogo: storeLogo || undefined,
    });
  };

  const openAddUser = () => {
    setEditUserId(null);
    setUserName('');
    setUserUsername('');
    setUserPassword('');
    setUserRole('Kasir');
    setShowUserForm(true);
  };

  const openEditUser = (u: User) => {
    setEditUserId(u.id);
    setUserName(u.name);
    setUserUsername(u.username);
    setUserPassword('');
    setUserRole(u.role);
    setShowUserForm(true);
  };

  const saveUser = () => {
    // Check username uniqueness
    const existingUser = users.find(u => u.username === userUsername && u.id !== editUserId);
    if (existingUser) {
      alert('Username sudah digunakan. Pilih username lain.');
      return;
    }

    if (editUserId) {
      const data: Partial<User> = { name: userName, username: userUsername, role: userRole };
      if (userPassword) data.password = userPassword;
      updateUser(editUserId, data);
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'update_user', `Edit user: ${userName}`, { userId: editUserId });
      }
    } else {
      const newId = uuid();
      addUser({
        id: newId,
        name: userName,
        username: userUsername,
        password: userPassword,
        role: userRole,
        createdAt: new Date().toISOString(),
      });
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'create_user', `Tambah user: ${userName} (${userRole})`, { userId: newId });
      }
    }
    setShowUserForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-center sm:text-left w-full sm:w-auto">⚙️ Settings</h1>
      </div>

      {/* Tab Menu */}
      <div className="flex border-b border-slate-200 dark:border-slate-700/50 overflow-x-auto scrollbar-none whitespace-nowrap -mx-4 px-4 sm:mx-0 sm:px-0">
        <button
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all flex-shrink-0 ${
            activeTab === 'general'
              ? 'border-brand-600 text-brand-600 dark:text-brand-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Store size={16} />
          <span>Umum & Tampilan</span>
        </button>
        <button
          onClick={() => setActiveTab('printers')}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all flex-shrink-0 ${
            activeTab === 'printers'
              ? 'border-brand-600 text-brand-600 dark:text-brand-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Printer size={16} />
          <span>Printer & KDS</span>
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all flex-shrink-0 ${
            activeTab === 'users'
              ? 'border-brand-600 text-brand-600 dark:text-brand-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Users size={16} />
          <span>Pengguna & Sistem</span>
        </button>
      </div>

      {activeTab === 'general' && (
        <div className="space-y-6">
          {/* Store Settings */}
          <div className="card p-5">
        <h2 className="font-bold text-lg flex items-center gap-2 mb-4">
          <Store size={18} /> Pengaturan Toko
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
          {/* Logo */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-32 h-32 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden bg-slate-50 dark:bg-slate-800">
              {storeLogo ? (
                <img src={storeLogo} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <div className="text-center text-slate-400">
                  <ImagePlus size={32} className="mx-auto mb-1" />
                  <p className="text-xs">Logo Toko</p>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-secondary text-xs"
              >
                <ImagePlus size={14} /> Upload
              </button>
              {storeLogo && (
                <button
                  onClick={() => setStoreLogo('')}
                  className="btn-ghost text-xs text-red-500"
                >
                  <X size={14} /> Hapus
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
            <p className="text-xs text-slate-400">Maks. 500KB (PNG/JPG)</p>
          </div>

          {/* Store Info */}
          <div className="space-y-4">
            <div>
              <label className="label">Nama Toko</label>
              <input
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="input"
                placeholder="Nama toko Anda"
              />
            </div>
            <div>
              <label className="label">Alamat</label>
              <input
                value={storeAddress}
                onChange={(e) => setStoreAddress(e.target.value)}
                className="input"
                placeholder="Alamat toko"
              />
            </div>
            <button onClick={saveStoreSettings} className="btn-primary">
              <Save size={16} /> Simpan Pengaturan Toko
            </button>
          </div>
        </div>
      </div>

      {/* Pengaturan Pajak (PB1 / PPN) */}
      <div className="card p-5">
        <h2 className="font-bold text-lg flex items-center gap-2 mb-2">
          <Percent size={18} className="text-brand-600" /> Pengaturan Pajak (PB1 / PPN)
        </h2>
        <p className="text-xs text-slate-500 mb-6">
          Aktifkan atau nonaktifkan pemotongan pajak secara otomatis pada setiap transaksi kasir (POS), dan sesuaikan besaran persentasenya (misal PB1 10% atau PPN 11%).
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-5">
            {/* Toggle Status Pajak */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
              <div>
                <p className="font-semibold text-sm text-slate-800 dark:text-slate-100">Status Fitur Pajak</p>
                <p className="text-xs text-slate-500">
                  {taxEnabled ? 'Pajak AKTIF — dikenakan pada transaksi POS' : 'Pajak NONAKTIF — tidak ada pajak pada transaksi POS'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTaxEnabled(!taxEnabled)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  taxEnabled ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    taxEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Input Persentase Pajak */}
            <div className={taxEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none transition-opacity'}>
              <label className="label">Persentase Pajak (%)</label>
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={taxPercentInput}
                    onChange={(e) => setTaxPercentInput(e.target.value)}
                    placeholder="0"
                    className="input pr-8 font-semibold text-lg"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">%</span>
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Preset Cepat:</span>
                {[0, 5, 10, 11, 12].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setTaxPercentInput(String(pct))}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                      parseFloat(taxPercentInput) === pct
                        ? 'bg-brand-100 text-brand-700 border-brand-300 dark:bg-brand-900/50 dark:text-brand-300'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            <button onClick={saveTaxSettings} className="btn-primary">
              <Save size={16} /> Simpan Pengaturan Pajak
            </button>
          </div>

          {/* Live Preview Calculation */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                <Receipt size={14} /> Simulasi Perhitungan Transaksi
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Subtotal Pesanan (Contoh)</span>
                  <span className="font-medium">Rp 100.000</span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>
                    Pajak ({taxEnabled ? `${parseFloat(taxPercentInput) || 0}%` : 'Nonaktif'})
                  </span>
                  <span className={`font-medium ${taxEnabled && (parseFloat(taxPercentInput) || 0) > 0 ? 'text-green-600 font-semibold' : 'text-slate-400'}`}>
                    + {formatRupiah(taxEnabled ? Math.round(100000 * ((parseFloat(taxPercentInput) || 0) / 100)) : 0)}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between font-bold text-base text-slate-900 dark:text-slate-100">
                  <span>Total Tagihan POS</span>
                  <span className="text-brand-700 dark:text-brand-400">
                    {formatRupiah(100000 + (taxEnabled ? Math.round(100000 * ((parseFloat(taxPercentInput) || 0) / 100)) : 0))}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40 text-xs text-blue-700 dark:text-blue-300">
              💡 <strong>Catatan:</strong> Jika pajak diaktifkan, pajak akan dihitung dari Net Subtotal (setelah diskon) dan dibulatkan ke rupiah terdekat saat checkout.
            </div>
          </div>
        </div>
      </div>

      {/* Pengaturan Tema Warna UI */}
      <div className="card p-5">
        <h2 className="font-bold text-lg flex items-center gap-2 mb-2">
          <Palette size={18} className="text-brand-600" /> Pengaturan Tema Warna UI
        </h2>
        <p className="text-xs text-slate-500 mb-6">
          Sesuaikan tema warna aplikasi Anda secara manual. Anda dapat menggunakan preset, menghasilkan gradasi otomatis dari warna dasar, atau mengubah setiap tingkat warna secara detail.
        </p>

        <div className="space-y-6">
          {/* Preset Themes */}
          <div>
            <label className="label text-sm font-semibold mb-2">Preset Tema Pilihan</label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`flex flex-col items-center p-3 rounded-xl border text-left transition-all ${
                    themeColor === preset.color
                      ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-900/10 ring-2 ring-brand-400/20'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-full shadow-inner mb-2 border border-black/10"
                    style={{ backgroundColor: preset.color }}
                  />
                  <span className="text-xs font-semibold text-center text-slate-700 dark:text-slate-200">
                    {preset.name.split(' (')[0]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-700/50 pt-4 grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Color Generator */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300">Generator Tema Warna</h3>
              <div>
                <label className="label text-xs">Pilih Warna Dasar</label>
                <div className="flex gap-2">
                  <div className="relative w-12 h-11 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 flex-shrink-0">
                    <input
                      type="color"
                      value={themeColor}
                      onChange={(e) => {
                        setThemeColor(e.target.value);
                      }}
                      className="absolute inset-0 w-full h-full p-0 border-0 cursor-pointer scale-150"
                    />
                  </div>
                  <input
                    type="text"
                    value={themeColor}
                    onChange={(e) => setThemeColor(e.target.value)}
                    placeholder="#b85f21"
                    className="input py-2 text-sm font-mono"
                    maxLength={7}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleAutoGenerateShades(themeColor)}
                className="btn-secondary text-xs w-full py-2.5 flex items-center justify-center gap-1.5"
              >
                <Palette size={14} /> Buat Gradasi Otomatis
              </button>
              <p className="text-[11px] text-slate-400">
                * Tombol ini akan otomatis menghitung tingkat kecerahan warna (dari shade 50 hingga 900) berdasarkan warna dasar di atas.
              </p>
            </div>

            {/* Shades Adjustment */}
            <div className="md:col-span-2 space-y-4">
              <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300">Penyesuaian Gradasi Warna Manual</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {Object.keys(themeShades).map((shadeKey) => {
                  const shade = shadeKey;
                  return (
                    <div key={shade} className="p-2 border border-slate-100 dark:border-slate-700/60 rounded-xl bg-slate-50/50 dark:bg-slate-800/20">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-bold text-slate-500">Shade {shade}</span>
                        <div
                          className="w-3.5 h-3.5 rounded-full border border-black/10"
                          style={{ backgroundColor: themeShades[shade] }}
                        />
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          type="color"
                          value={themeShades[shade]}
                          onChange={(e) => handleShadeChange(shade, e.target.value)}
                          className="w-6 h-7 p-0 border-0 cursor-pointer rounded-lg overflow-hidden flex-shrink-0"
                        />
                        <input
                          type="text"
                          value={themeShades[shade]}
                          onChange={(e) => handleShadeChange(shade, e.target.value)}
                          className="input py-0.5 px-1 text-[10px] font-mono text-center rounded-lg border-slate-200 dark:border-slate-600"
                          maxLength={7}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Dynamic Live Palette Preview */}
              <div>
                <label className="label text-[11px] text-slate-400 mb-1">Preview Gradasi Warna Aktif</label>
                <div className="flex h-4 w-full rounded-md overflow-hidden shadow-inner border border-black/5">
                  {Object.entries(themeShades).map(([shade, hex]) => (
                    <div
                      key={shade}
                      className="flex-1 h-full relative group cursor-help"
                      style={{ backgroundColor: hex }}
                      title={`Shade ${shade}: ${hex}`}
                    >
                      <div className="hidden group-hover:block absolute bottom-5 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] px-1 py-0.5 rounded shadow whitespace-nowrap z-10 font-mono">
                        {shade}: {hex}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-700/50">
            <button
              type="button"
              onClick={() => {
                setThemeColor(settings.themeColor || '#b85f21');
                setThemeShades((settings.themeShades && Object.keys(settings.themeShades).length > 0) ? (settings.themeShades as any) : {
                  50: '#fdf8f3',
                  100: '#f9ebd9',
                  200: '#f2d4ae',
                  300: '#e9b67a',
                  400: '#de9348',
                  500: '#d17a2a',
                  600: '#b85f21',
                  700: '#94481f',
                  800: '#763b20',
                  900: '#60311d',
                });
              }}
              className="btn-secondary text-xs"
            >
              <RotateCcw size={14} /> Batal Perubahan
            </button>
            <button onClick={saveThemeSettings} className="btn-primary text-xs">
              <Save size={14} /> Simpan Tema Warna
            </button>
          </div>
        </div>
      </div>

      {/* PIN Manager */}
      <div className="card p-5">
        <h2 className="font-bold text-lg flex items-center gap-2 mb-4">
          <Key size={18} /> PIN Manager
        </h2>
        <div className="flex gap-3 items-end">
          <div className="flex-1 max-w-xs">
            <label className="label">PIN Baru (4-6 digit)</label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="input font-mono text-center tracking-widest"
              maxLength={6}
              placeholder="Masukkan PIN baru"
            />
            <p className="text-xs text-slate-400 mt-1">PIN saat ini tersimpan aman (terenkripsi). Masukkan PIN baru untuk mengubah.</p>
          </div>
          <button
            onClick={() => {
              if (pin.length >= 4) {
                updateSettings({ managerPin: pin });
                setPin('');
                alert('PIN Manager berhasil diubah!');
              }
            }}
            className="btn-primary"
            disabled={pin.length < 4}
          >
            <Save size={16} /> Simpan PIN
          </button>
        </div>
      </div>
      </div>
      )}

      {activeTab === 'printers' && (
        <div className="space-y-6">
          {/* Printer Settings */}
          <div className="card p-5">
        <h2 className="font-bold text-lg flex items-center gap-2 mb-4">
          <Printer size={18} /> Integrasi Printer Thermal
        </h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Aktifkan Printer</p>
              <p className="text-xs text-slate-500">Cetak struk saat transaksi selesai</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.printerEnabled}
                onChange={(e) => updateSettings({ printerEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Auto Print saat Checkout</p>
              <p className="text-xs text-slate-500">Otomatis cetak struk setelah pembayaran</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoPrintOnCheckout}
                onChange={(e) => updateSettings({ autoPrintOnCheckout: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Metode Cetak</label>
              <select
                value={settings.printerType}
                onChange={(e) => updateSettings({ printerType: e.target.value as 'browser' | 'bluetooth' })}
                className="input"
              >
                <option value="browser">Browser Print (window.print)</option>
                <option value="bluetooth">Bluetooth (Web Bluetooth API)</option>
              </select>
            </div>
            <div>
              <label className="label">Lebar Kertas</label>
              <select
                value={settings.printerWidth}
                onChange={(e) => updateSettings({ printerWidth: e.target.value as '58mm' | '80mm' })}
                className="input"
              >
                <option value="58mm">58mm (Mini)</option>
                <option value="80mm">80mm (Standard)</option>
              </select>
            </div>
          </div>

          {settings.printerType === 'bluetooth' && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-xl text-sm space-y-3 border border-amber-200 dark:border-amber-900/50">
              <div>
                <p className="font-semibold text-amber-800 dark:text-amber-300">🔗 Printer Kasir — Bluetooth</p>
                <p className="text-xs mt-1 text-amber-700 dark:text-amber-400">
                  Hubungkan printer thermal Bluetooth untuk mencetak struk konsumen. Pastikan printer sudah menyala.
                </p>
              </div>
              
              {/* Device Info */}
              <div className="flex items-center gap-2 p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isBluetoothConnected(CASHIER_PRINTER_ID) ? 'bg-green-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">
                    {isBluetoothConnected(CASHIER_PRINTER_ID)
                      ? `${getBluetoothStatus(CASHIER_PRINTER_ID).deviceName}`
                      : settings.cashierBluetoothDeviceName
                        ? `${settings.cashierBluetoothDeviceName} (Terputus)`
                        : 'Belum ada printer terhubung'}
                  </p>
                  <p className={`text-[10px] ${isBluetoothConnected(CASHIER_PRINTER_ID) ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}`}>
                    {isBluetoothConnected(CASHIER_PRINTER_ID) ? '● Connected' : '○ Disconnected'}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={async () => {
                    const result = await connectBluetoothPrinter(CASHIER_PRINTER_ID);
                    if (result.success) {
                      updateSettings({
                        cashierBluetoothDeviceId: result.deviceId,
                        cashierBluetoothDeviceName: result.deviceName,
                      });
                      alert(`Printer Kasir berhasil terhubung ke "${result.deviceName}"!`);
                    }
                  }}
                  className="btn-primary text-xs"
                >
                  <Printer size={14} /> {isBluetoothConnected(CASHIER_PRINTER_ID) ? 'Ganti Printer' : 'Hubungkan Printer'}
                </button>
                {isBluetoothConnected(CASHIER_PRINTER_ID) && (
                  <>
                    <button
                      onClick={async () => {
                        try {
                          await testPrintBluetooth(CASHIER_PRINTER_ID, 'Printer Kasir', 'Kasir', settings.printerWidth);
                          alert('Test Print Kasir berhasil!');
                        } catch (err: any) {
                          alert(`Test Print gagal: ${err.message}`);
                        }
                      }}
                      className="btn-secondary text-xs"
                    >
                      🖨️ Test Print
                    </button>
                    <button
                      onClick={() => { disconnectBluetoothPrinter(CASHIER_PRINTER_ID); alert('Printer Kasir diputus.'); }}
                      className="btn-secondary text-xs text-red-600"
                    >
                      Putuskan
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {settings.printerType === 'browser' && (
            <div className="p-3 bg-blue-50 rounded-xl text-sm text-blue-700">
              <p className="font-medium">ℹ️ Browser Print</p>
              <p className="text-xs mt-1">
                Struk akan dicetak menggunakan dialog print browser. Atur printer default 
                ke printer thermal Anda di pengaturan sistem operasi untuk hasil terbaik.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Kitchen Printers Settings */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2">
              <Printer size={18} className="text-brand-600" />
              Printer Dapur & Bar (Split Print)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Setiap printer dapur/bar memiliki koneksi Bluetooth independen</p>
          </div>
          <button
            onClick={() => {
              const newPrinters = [...(settings.kitchenPrinters || [])];
              newPrinters.push({
                id: uuid(),
                name: `Printer Dapur ${newPrinters.length + 1}`,
                targetCategory: newPrinters.length === 0 ? 'Minuman' : 'Makanan',
                enabled: true,
                type: 'browser',
                width: '58mm'
              });
              updateSettings({ kitchenPrinters: newPrinters });
            }}
            className="btn-secondary text-xs flex items-center gap-1 self-start sm:self-center"
          >
            <Plus size={14} /> Tambah Printer Dapur
          </button>
        </div>

        <div className="space-y-4">
          {(settings.kitchenPrinters || []).length === 0 ? (
            <div className="text-center py-8 border border-dashed border-slate-200 dark:border-slate-700/60 rounded-xl">
              <p className="text-sm text-slate-400">Belum ada printer dapur yang dikonfigurasi</p>
              <p className="text-xs text-slate-400 mt-1">Struk pesanan dapur terpisah dinonaktifkan. Semua struk dicetak di kasir utama.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {(settings.kitchenPrinters || []).map((kp, idx) => (
                <div key={kp.id} className={`border rounded-xl overflow-hidden ${kp.enabled ? 'border-brand-200 dark:border-brand-800/50 bg-white dark:bg-slate-800/50' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 opacity-60'}`}>
                  {/* Card Header */}
                  <div className="flex items-center justify-between p-3 border-b border-slate-100 dark:border-slate-700/50">
                    <div className="flex items-center gap-2">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={kp.enabled}
                          onChange={(e) => {
                            const newPrinters = [...(settings.kitchenPrinters || [])];
                            newPrinters[idx] = { ...kp, enabled: e.target.checked };
                            updateSettings({ kitchenPrinters: newPrinters });
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:ring-2 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-600"></div>
                      </label>
                      <span className="font-semibold text-sm">{kp.name || 'Printer Dapur'}</span>
                    </div>
                    <button
                      onClick={() => {
                        const newPrinters = (settings.kitchenPrinters || []).filter((p) => p.id !== kp.id);
                        updateSettings({ kitchenPrinters: newPrinters });
                      }}
                      className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-400 hover:text-red-600"
                      title="Hapus Printer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Card Body */}
                  <div className="p-3 space-y-3">
                    {/* Config Fields */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Nama</label>
                        <input
                          type="text"
                          value={kp.name}
                          onChange={(e) => {
                            const newPrinters = [...(settings.kitchenPrinters || [])];
                            newPrinters[idx] = { ...kp, name: e.target.value };
                            updateSettings({ kitchenPrinters: newPrinters });
                          }}
                          className="input py-1.5 px-2 text-xs mt-0.5"
                          placeholder="Nama Printer"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Target Dapur</label>
                        <input
                          type="text"
                          value={kp.targetCategory}
                          onChange={(e) => {
                            const newPrinters = [...(settings.kitchenPrinters || [])];
                            newPrinters[idx] = { ...kp, targetCategory: e.target.value };
                            updateSettings({ kitchenPrinters: newPrinters });
                          }}
                          className="input py-1.5 px-2 text-xs mt-0.5"
                          placeholder="Contoh: Minuman"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Tipe</label>
                        <select
                          value={kp.type}
                          onChange={(e) => {
                            const newPrinters = [...(settings.kitchenPrinters || [])];
                            newPrinters[idx] = { ...kp, type: e.target.value as 'browser' | 'bluetooth' };
                            updateSettings({ kitchenPrinters: newPrinters });
                          }}
                          className="input py-1.5 px-2 text-xs mt-0.5"
                        >
                          <option value="browser">Browser Print</option>
                          <option value="bluetooth">Bluetooth</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Lebar</label>
                        <select
                          value={kp.width}
                          onChange={(e) => {
                            const newPrinters = [...(settings.kitchenPrinters || [])];
                            newPrinters[idx] = { ...kp, width: e.target.value as '58mm' | '80mm' };
                            updateSettings({ kitchenPrinters: newPrinters });
                          }}
                          className="input py-1.5 px-2 text-xs mt-0.5"
                        >
                          <option value="58mm">58mm</option>
                          <option value="80mm">80mm</option>
                        </select>
                      </div>
                    </div>

                    {/* Bluetooth Device Binding */}
                    {kp.type === 'bluetooth' && (
                      <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700/50 space-y-2">
                        {/* Device Status */}
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isBluetoothConnected(kp.id) ? 'bg-green-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`} />
                          <p className="text-xs flex-1 min-w-0 truncate">
                            {isBluetoothConnected(kp.id)
                              ? `${getBluetoothStatus(kp.id).deviceName} — Connected`
                              : kp.bluetoothDeviceName
                                ? `${kp.bluetoothDeviceName} (Terputus)`
                                : 'Belum ada printer Bluetooth'}
                          </p>
                        </div>

                        {/* Bluetooth Actions */}
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={async () => {
                              const result = await connectBluetoothPrinter(kp.id);
                              if (result.success) {
                                // Check duplicate device
                                const duplicate = getDuplicateDeviceInfo(result.deviceId!, kp.id, settings);
                                if (duplicate) {
                                  alert(`⚠️ Perhatian: Device "${result.deviceName}" juga digunakan oleh "${duplicate.printerName}". Dua printer mengirim ke device fisik yang sama.`);
                                }
                                // Save device info
                                const newPrinters = [...(settings.kitchenPrinters || [])];
                                newPrinters[idx] = {
                                  ...kp,
                                  bluetoothDeviceId: result.deviceId,
                                  bluetoothDeviceName: result.deviceName,
                                };
                                updateSettings({ kitchenPrinters: newPrinters });
                                alert(`"${kp.name}" terhubung ke "${result.deviceName}"!`);
                              }
                            }}
                            className="text-[11px] px-2 py-1 rounded bg-brand-600 text-white hover:bg-brand-700"
                          >
                            {isBluetoothConnected(kp.id) ? 'Ganti' : 'Hubungkan'}
                          </button>
                          {isBluetoothConnected(kp.id) && (
                            <>
                              <button
                                onClick={async () => {
                                  try {
                                    await testPrintBluetooth(kp.id, kp.name, kp.targetCategory, kp.width);
                                    alert(`Test Print "${kp.name}" berhasil!`);
                                  } catch (err: any) {
                                    alert(`Test Print gagal: ${err.message}`);
                                  }
                                }}
                                className="text-[11px] px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600"
                              >
                                Test Print
                              </button>
                              <button
                                onClick={() => {
                                  disconnectBluetoothPrinter(kp.id);
                                  alert(`"${kp.name}" diputus.`);
                                }}
                                className="text-[11px] px-2 py-1 rounded text-red-600 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40"
                              >
                                Putus
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          
          <div className="p-3 bg-blue-50/50 dark:bg-slate-800 rounded-xl text-xs text-slate-600 dark:text-slate-400">
            <p className="font-semibold">💡 Tips Split Printing:</p>
            <p className="mt-1">
              • Setiap printer Bluetooth memiliki koneksi <strong>independen</strong>. Kegagalan satu printer tidak menggagalkan printer lainnya.
            </p>
            <p className="mt-0.5">
              • Setiap menu produk dapat diatur target dapurnya di halaman Katalog Menu (misal: target <strong>Minuman</strong> atau <strong>Makanan</strong>).
            </p>
            <p className="mt-0.5">
              • Setelah browser di-refresh, koneksi Bluetooth perlu dihubungkan ulang (keterbatasan Web Bluetooth API).
            </p>
          </div>
        </div>
      </div>

      {/* Pengaturan Format & Teks Struk */}
      <div className="card p-5">
        <h2 className="font-bold text-lg flex items-center gap-2 mb-4">
          <FileText size={18} className="text-brand-600" /> Pengaturan Format & Preview Struk
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Form Settings */}
          <div className="lg:col-span-7 space-y-4">
            {/* Logo Settings */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">Tampilkan Logo Toko pada Struk</p>
                  <p className="text-xs text-slate-500">Cetak logo toko di bagian atas struk belanja</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.showLogoOnReceipt !== false}
                    onChange={(e) => updateSettings({ showLogoOnReceipt: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
                </label>
              </div>

              {settings.showLogoOnReceipt !== false && (
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center gap-4">
                  {settings.storeLogo ? (
                    <div className="relative group flex-shrink-0">
                      <img src={settings.storeLogo} alt="Logo Toko" className="w-16 h-16 object-contain p-1 bg-white dark:bg-slate-900 border rounded-lg" />
                      <button
                        onClick={() => updateSettings({ storeLogo: '' })}
                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 shadow hover:bg-red-600"
                        title="Hapus Logo"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center text-slate-400 text-[10px]">
                      <Upload size={16} />
                      <span>Belum ada</span>
                    </div>
                  )}

                  <div className="flex-1">
                    <label className="btn-secondary text-xs inline-flex items-center gap-1.5 cursor-pointer">
                      <Upload size={14} />
                      <span>{settings.storeLogo ? 'Ganti Logo Toko' : 'Upload Logo Toko'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                    </label>
                    <p className="text-[11px] text-slate-400 mt-1">Format PNG, JPG, atau WebP (rekomendasi maks 200KB)</p>
                  </div>
                </div>
              )}
            </div>

            {/* Header Text */}
            <div>
              <label className="label">Teks Header Tambahan (Slogan / Pesan atas)</label>
              <input
                type="text"
                value={settings.receiptHeader || ''}
                onChange={(e) => updateSettings({ receiptHeader: e.target.value })}
                className="input"
                placeholder="Contoh: Selamat Datang di BerdikariPOS!"
              />
              <p className="text-xs text-slate-400 mt-1">Dicetak di bagian paling atas struk (bawah nama toko).</p>
            </div>

            {/* Footer Text */}
            <div>
              <label className="label">Teks Footer Tambahan (Catatan Kaki Struk)</label>
              <input
                type="text"
                value={settings.receiptFooter || ''}
                onChange={(e) => updateSettings({ receiptFooter: e.target.value })}
                className="input"
                placeholder="Contoh: Terima kasih atas kunjungan Anda! IG: @berdikaripos"
              />
              <p className="text-xs text-slate-400 mt-1">Dicetak di bagian paling bawah struk.</p>
            </div>
          </div>

          {/* Live Receipt Preview */}
          <div className="lg:col-span-5 flex flex-col items-center justify-start">
            <div className="w-full max-w-xs bg-amber-50/60 dark:bg-slate-900/80 p-4 rounded-xl border border-amber-200 dark:border-slate-700 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-amber-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1"><Printer size={14} /> Live Preview Struk</span>
                <span className="badge bg-amber-200 dark:bg-slate-700 text-amber-800 dark:text-slate-200">{settings.printerWidth || '58mm'}</span>
              </div>

              {/* Thermal Paper Roll Mockup */}
              <div className="mt-3 p-4 bg-white text-slate-900 font-mono text-[11px] leading-snug rounded shadow-md border border-slate-200 select-none">
                {/* Logo */}
                {settings.showLogoOnReceipt !== false && settings.storeLogo && (
                  <div className="flex justify-center mb-2">
                    <img src={settings.storeLogo} alt="Logo" className="max-h-12 object-contain" />
                  </div>
                )}

                {/* Header */}
                <div className="text-center font-bold text-sm uppercase tracking-wide">
                  {settings.storeName || 'NAMA TOKO'}
                </div>
                {settings.address && (
                  <div className="text-center text-[10px] text-slate-600">
                    {settings.address}
                  </div>
                )}
                {settings.receiptHeader && (
                  <div className="text-center text-[10px] text-slate-600 mt-1">
                    {settings.receiptHeader}
                  </div>
                )}
                
                <div className="my-2 border-b border-dashed border-slate-300"></div>

                {/* Tx Info */}
                <div className="text-[10px] flex justify-between items-start">
                  <div className="space-y-0.5">
                    <div>No: #101</div>
                    <div>Tgl: {new Date().toLocaleDateString('id-ID')} 14:30</div>
                    <div>Kasir: Budi</div>
                  </div>
                  <div className="text-right font-black uppercase text-xs tracking-wider text-slate-900 dark:text-slate-100 leading-tight">
                    <div>DINE IN</div>
                    <div>MEJA 3</div>
                  </div>
                </div>

                <div className="my-2 border-b border-dashed border-slate-300"></div>

                {/* Sample Items */}
                <div className="space-y-1 text-[10px]">
                  <div>
                    <div className="font-semibold">Nasi Goreng Spesial</div>
                    <div className="flex justify-between pl-2 text-slate-600">
                      <span>1x 25.000</span>
                      <span>25.000</span>
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold">Wedang Uwuh</div>
                    <div className="flex justify-between pl-2 text-slate-600">
                      <span>2x 12.000</span>
                      <span>24.000</span>
                    </div>
                  </div>
                </div>

                <div className="my-2 border-b border-dashed border-slate-300"></div>

                {/* Totals */}
                <div className="space-y-0.5 text-[10px]">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>49.000</span>
                  </div>
                  {settings.taxEnabled !== false && settings.taxPercent && settings.taxPercent > 0 ? (
                    <div className="flex justify-between">
                      <span>Pajak ({settings.taxPercent}%)</span>
                      <span>4.900</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between font-bold text-xs pt-1 border-t border-slate-200">
                    <span>TOTAL</span>
                    <span>{formatRupiah(settings.taxEnabled !== false && settings.taxPercent && settings.taxPercent > 0 ? 53900 : 49000)}</span>
                  </div>
                  <div className="flex justify-between pt-1">
                    <span>Bayar (Cash)</span>
                    <span>50.000</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Kembali</span>
                    <span>1.000</span>
                  </div>
                </div>

                <div className="my-2 border-b border-dashed border-slate-300"></div>

                {/* Footer */}
                <div className="text-center text-[10px] text-slate-600 mt-2">
                  {settings.receiptFooter || 'Terima kasih atas kunjungan Anda!\nSemoga sehat selalu'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pengaturan Nomor Meja */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2">
              <Store size={18} className="text-brand-600" />
              Fitur Nomor Meja Konsumen
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Kelola nomor meja untuk pesanan makan di tempat (Dine In)
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.tableFeaturesEnabled || false}
              onChange={(e) => updateSettings({ tableFeaturesEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
          </label>
        </div>

        {settings.tableFeaturesEnabled && (
          <div className="space-y-4">
            <div>
              <label className="label text-sm font-semibold">Daftar Nomor Meja yang Tersedia</label>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  placeholder="Contoh: Meja 6, Area Outdoor 2..."
                  value={newTableInput}
                  onChange={(e) => setNewTableInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTable()}
                  className="input text-sm"
                />
                <button
                  type="button"
                  onClick={handleAddTable}
                  className="btn-primary text-sm whitespace-nowrap"
                >
                  <Plus size={16} /> Tambah Meja
                </button>
              </div>

              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 border border-slate-100 dark:border-slate-700/50 rounded-xl bg-slate-50/50 dark:bg-slate-800/30">
                {(settings.availableTableNumbers || []).length === 0 ? (
                  <p className="text-xs text-slate-400 p-3 w-full text-center">Belum ada nomor meja yang terdaftar</p>
                ) : (
                  (settings.availableTableNumbers || []).map((t, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-xs font-medium text-slate-700 dark:text-slate-300 shadow-sm"
                    >
                      <span>{t}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTable(t)}
                        className="text-slate-400 hover:text-red-500 rounded-full p-0.5"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
      )}

      {activeTab === 'users' && (
        <div className="space-y-6">
          {/* User Management */}
          <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Users size={18} /> Manajemen User
          </h2>
          <button onClick={openAddUser} className="btn-primary text-sm">
            <Plus size={16} /> Tambah User
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-700">
              <tr>
                <th className="text-left p-3 font-semibold">Nama</th>
                <th className="text-left p-3 font-semibold">Username</th>
                <th className="text-left p-3 font-semibold">Role</th>
                <th className="text-center p-3 font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 dark:border-slate-700/40">
                  <td className="p-3 font-medium">{u.name}</td>
                  <td className="p-3 text-slate-500 dark:text-slate-400">{u.username}</td>
                  <td className="p-3">
                    <span className={`badge ${
                      u.role === 'Manager' ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' :
                      u.role === 'Kasir' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' :
                      u.role === 'Staf Gudang' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' :
                      'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openEditUser(u)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
                        <Pencil size={14} />
                      </button>
                      {u.id !== currentUser?.id && (
                        <button onClick={() => {
                          // BUG-M7 fix: Check if user has active shift before deleting
                          const hasActiveShift = shifts.some((s) => s.userId === u.id && s.status === 'open');
                          if (hasActiveShift) {
                            alert(`⚠️ User "${u.name}" masih memiliki shift aktif. Tutup shift terlebih dahulu.`);
                            return;
                          }
                          if (!window.confirm(`Hapus user "${u.name}"? Tindakan ini tidak bisa dibatalkan.`)) return;
                          deleteUser(u.id);
                          if (currentUser) {
                            addLog(currentUser.id, currentUser.name, currentUser.role, 'delete_user', `Hapus user: ${u.name}`, { userId: u.id });
                          }
                        }} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Form Modal */}
      <Modal open={showUserForm} onClose={() => setShowUserForm(false)} title={editUserId ? 'Edit User' : 'Tambah User'}>
        <div className="space-y-4">
          <div>
            <label className="label">Nama Lengkap</label>
            <input value={userName} onChange={(e) => setUserName(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Username</label>
            <input value={userUsername} onChange={(e) => setUserUsername(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Password {editUserId && '(kosongkan jika tidak diubah)'}</label>
            <input type="password" value={userPassword} onChange={(e) => setUserPassword(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Role</label>
            <select value={userRole} onChange={(e) => setUserRole(e.target.value as Role)} className="input">
              <option value="Manager">Manager</option>
              <option value="Kasir">Kasir</option>
              <option value="Acaraki">Acaraki</option>
              <option value="Staf Gudang">Staf Gudang</option>
            </select>
          </div>
          <div className="flex gap-3 pt-3 border-t border-slate-100">
            <button onClick={() => setShowUserForm(false)} className="btn-secondary flex-1">Batal</button>
            <button onClick={saveUser} className="btn-primary flex-1" disabled={!userName || !userUsername || (!editUserId && !userPassword)}>
              {editUserId ? 'Simpan' : 'Tambah'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Data Management — Protected by Super Admin PIN */}
      <div className="card p-5 border-red-200">
        <h2 className="font-bold text-lg flex items-center gap-2 mb-4 text-red-700">
          <Database size={18} /> Manajemen Data
        </h2>

        {!superAdminUnlocked ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Section ini dilindungi. Masukkan Super Admin PIN untuk mengakses.
            </p>
            <div className="flex gap-2 max-w-xs">
              <input
                type="password"
                value={superPinInput}
                onChange={(e) => { setSuperPinInput(e.target.value.replace(/\D/g, '')); setSuperPinError(''); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // BUG-M4: Support bcrypt-hashed super admin PIN
                    const stored = settings.superAdminPin;
                    const isMatch = stored.startsWith('$2') ? bcrypt.compareSync(superPinInput, stored) : superPinInput === stored;
                    if (isMatch) { setSuperAdminUnlocked(true); setSuperPinError(''); }
                    else setSuperPinError('PIN salah');
                  }
                }}
                placeholder="Super Admin PIN"
                className="input font-mono text-center tracking-widest"
                maxLength={6}
              />
              <button
                onClick={() => {
                  // BUG-M4: Support bcrypt-hashed super admin PIN
                  const stored = settings.superAdminPin;
                  const isMatch = stored.startsWith('$2') ? bcrypt.compareSync(superPinInput, stored) : superPinInput === stored;
                  if (isMatch) { setSuperAdminUnlocked(true); setSuperPinError(''); }
                  else setSuperPinError('PIN salah');
                }}
                className="btn-primary text-sm"
              >
                Buka
              </button>
            </div>
            {superPinError && <p className="text-xs text-red-500">{superPinError}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Demo Mode Toggle */}
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
              <div>
                <p className="font-medium text-sm">Mode Demo</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tampilkan info akun demo di halaman login. Matikan untuk produksi klien.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.demoMode}
                  onChange={(e) => updateSettings({ demoMode: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
              </label>
            </div>

            {/* Change Super Admin PIN */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Ubah Super Admin PIN</p>
                  <p className="text-xs text-slate-500 mt-0.5">PIN saat ini: ••••••</p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <input
                  type="password"
                  value={newSuperPin}
                  onChange={(e) => setNewSuperPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="PIN baru (4-6 digit)"
                  maxLength={6}
                  className="input w-40 text-center font-mono text-sm tracking-widest"
                />
                <button
                  onClick={() => {
                    if (newSuperPin.length >= 4) {
                      updateSettings({ superAdminPin: newSuperPin });
                      setNewSuperPin('');
                      alert('Super Admin PIN berhasil diubah!');
                    }
                  }}
                  disabled={newSuperPin.length < 4}
                  className="btn-primary text-xs"
                >
                  <Save size={14} /> Simpan
                </button>
              </div>
            </div>

            {/* Clear Operational Data */}
            <div className="flex items-center justify-between p-4 bg-amber-50 rounded-xl border border-amber-200">
              <div>
                <p className="font-medium text-sm">Bersihkan Data Transaksi</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Hapus transaksi, shift, pelanggan, promo, log. Menu & inventaris tetap.
                </p>
              </div>
              <button onClick={() => setShowClearConfirm(true)} className="btn-secondary text-xs text-amber-700 border-amber-300 whitespace-nowrap">
                <Trash2 size={14} /> Bersihkan
              </button>
            </div>

            {/* Reset to Default */}
            <div className="flex items-center justify-between p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div>
                <p className="font-medium text-sm">Reset ke Default (Demo)</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Kembalikan semua data ke seed default. Untuk reset demo.
                </p>
              </div>
              <button onClick={() => setShowResetConfirm(true)} className="btn-secondary text-xs text-blue-700 border-blue-300 whitespace-nowrap">
                <RotateCcw size={14} /> Reset
              </button>
            </div>

            {/* Factory Reset */}
            <div className="flex items-center justify-between p-4 bg-red-50 rounded-xl border border-red-200">
              <div>
                <p className="font-medium text-sm text-red-700">Factory Reset</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Hapus SEMUA data + cloud. Tidak bisa dikembalikan.
                </p>
              </div>
              <button onClick={() => setShowFactoryConfirm(true)} className="btn-danger text-xs whitespace-nowrap">
                <AlertTriangle size={14} /> Reset
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={clearOperationalData}
        title="Bersihkan Data Transaksi"
        message="Semua transaksi, shift, pelanggan, promo, dan log akan dihapus permanen (lokal + cloud). Menu, inventaris, user, dan settings tetap dipertahankan. Lanjutkan?"
        confirmText="Ya, Bersihkan"
        variant="warning"
      />

      <ConfirmDialog
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={resetToDefault}
        title="Reset ke Default"
        message="Semua data (lokal + cloud) akan dikembalikan ke keadaan awal (demo). Akun, menu, dan settings kembali ke default. Lanjutkan?"
        confirmText="Ya, Reset"
        variant="warning"
      />

      <ConfirmDialog
        open={showFactoryConfirm}
        onClose={() => setShowFactoryConfirm(false)}
        onConfirm={factoryReset}
        title="⚠️ Factory Reset"
        message="SEMUA DATA akan dihapus permanen (lokal + cloud). Akun default (manager, kasir, acaraki), menu demo, dan settings default akan di-restore. Tindakan ini TIDAK BISA dibatalkan. Yakin?"
        confirmText="HAPUS SEMUA"
        variant="danger"
      />
      </div>
      )}
    </div>
  );
}
