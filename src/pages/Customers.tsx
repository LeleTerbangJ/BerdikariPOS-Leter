import { useState, useEffect } from 'react';
import { v4 as uuid } from 'uuid';
import { useCustomerStore } from '../store/customerStore';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { formatRupiah } from '../utils/format';
import type { Customer } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import PinModal from '../components/PinModal';
import { Plus, Pencil, Trash2, Search, Users, Phone, Mail, MessageCircle, Send } from 'lucide-react';

export default function Customers() {
  const { customers, addCustomer, updateCustomer, deleteCustomer, loadFromCloud } = useCustomerStore();
  const { settings } = useSettingsStore();
  const { currentUser } = useAuthStore();
  const { addLog } = useAuditLogStore();

  // Real-time sync for customers
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const channelName = 'cust-rt-' + Math.random().toString(36).substring(2, 9);
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
        loadFromCloud(true); // fullSync: cloud is authoritative
      })
      .subscribe();
    return () => { try { supabase.removeChannel(channel); } catch (e) {} };
  }, []);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteCustomerId, setDeleteCustomerId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null); // BUG-16: PIN check before delete

  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // WhatsApp modal
  const [showWaModal, setShowWaModal] = useState(false);
  const [waCustomer, setWaCustomer] = useState<Customer | null>(null);
  const [waMessage, setWaMessage] = useState('');

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => {
    setEditId(null);
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormNotes('');
    setShowForm(true);
  };

  const openEdit = (c: Customer) => {
    setEditId(c.id);
    setFormName(c.name);
    setFormPhone(c.phone || '');
    setFormEmail(c.email || '');
    setFormNotes(c.notes || '');
    setShowForm(true);
  };

  const handleSave = () => {
    if (editId) {
      updateCustomer(editId, { name: formName, phone: formPhone, email: formEmail, notes: formNotes });
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'update_customer', `Edit pelanggan: ${formName}`, { customerId: editId });
      }
    } else {
      const newId = uuid();
      addCustomer({
        id: newId,
        name: formName,
        phone: formPhone,
        email: formEmail,
        notes: formNotes,
        totalSpent: 0,
        visitCount: 0,
        createdAt: new Date().toISOString(),
      });
      if (currentUser) {
        addLog(currentUser.id, currentUser.name, currentUser.role, 'create_customer', `Tambah pelanggan: ${formName}`, { customerId: newId });
      }
    }
    setShowForm(false);
  };

  const openWhatsApp = (c: Customer) => {
    setWaCustomer(c);
    setWaMessage(
      `Halo ${c.name}! 👋\n\nKami dari ${settings.storeName} punya penawaran spesial untuk Anda:\n\n🌿 [Tulis promo Anda di sini]\n\nDitunggu kedatangannya ya! 😊`
    );
    setShowWaModal(true);
  };

  const sendWhatsApp = () => {
    if (!waCustomer?.phone) return;
    // Format phone number for WhatsApp API
    let phone = waCustomer.phone.replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '62' + phone.slice(1);
    if (!phone.startsWith('62')) phone = '62' + phone;

    const encoded = encodeURIComponent(waMessage);
    window.open(`https://wa.me/${phone}?text=${encoded}`, '_blank');
    setShowWaModal(false);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-center sm:text-left w-full sm:w-auto">👥 Pelanggan (CRM)</h1>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama, telepon, email..."
          className="input pl-9 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center text-slate-400">
          <Users size={40} className="mx-auto mb-2 opacity-30" />
          <p>Belum ada data pelanggan</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold">{c.name}</h3>
                  {c.phone && (
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Phone size={11} /> {c.phone}
                    </p>
                  )}
                  {c.email && (
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <Mail size={11} /> {c.email}
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  {c.phone && (
                    <button
                      onClick={() => openWhatsApp(c)}
                      className="p-1.5 rounded-lg hover:bg-green-50 text-green-600"
                      title="Kirim WhatsApp"
                    >
                      <MessageCircle size={14} />
                    </button>
                  )}
                  <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-slate-100">
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => {
                      // BUG-16: Non-Manager must verify PIN before deleting
                      if (currentUser?.role !== 'Manager') {
                        setPendingDeleteId(c.id);
                      } else {
                        setDeleteCustomerId(c.id);
                      }
                    }}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="flex gap-4 text-xs">
                <div>
                  <p className="text-slate-500">Total Belanja</p>
                  <p className="font-semibold text-brand-700">{formatRupiah(c.totalSpent)}</p>
                </div>
                <div>
                  <p className="text-slate-500">Kunjungan</p>
                  <p className="font-semibold">{c.visitCount}x</p>
                </div>
              </div>
              {c.notes && (
                <p className="text-xs text-slate-400 mt-2 italic">"{c.notes}"</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Form Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editId ? 'Edit Pelanggan' : 'Tambah Pelanggan'}>
        <div className="space-y-4">
          <div>
            <label className="label">Nama *</label>
            <input value={formName} onChange={(e) => setFormName(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">No. Telepon (WhatsApp)</label>
            <input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} className="input" placeholder="08xxxxxxxxxx" />
          </div>
          <div>
            <label className="label">Email</label>
            <input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className="input" type="email" />
          </div>
          <div>
            <label className="label">Catatan</label>
            <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className="input" rows={2} />
          </div>
          <div className="flex gap-3 pt-3 border-t border-slate-100">
            <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">Batal</button>
            <button onClick={handleSave} className="btn-primary flex-1" disabled={!formName}>
              {editId ? 'Simpan' : 'Tambah'}
            </button>
          </div>
        </div>
      </Modal>

      {/* WhatsApp Modal */}
      <Modal open={showWaModal} onClose={() => setShowWaModal(false)} title="Kirim Pesan WhatsApp" maxWidth="max-w-md">
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <MessageCircle className="text-green-600" size={20} />
            </div>
            <div>
              <p className="font-medium text-sm">{waCustomer?.name}</p>
              <p className="text-xs text-slate-500">{waCustomer?.phone}</p>
            </div>
          </div>

          <div>
            <label className="label">Pesan Promosi / Penawaran</label>
            <textarea
              value={waMessage}
              onChange={(e) => setWaMessage(e.target.value)}
              className="input font-mono text-sm"
              rows={8}
            />
          </div>

          <p className="text-xs text-slate-400">
            Pesan akan dibuka di WhatsApp Web/App. Pastikan nomor HP pelanggan sudah benar.
          </p>

          <div className="flex gap-3 pt-3 border-t border-slate-100">
            <button onClick={() => setShowWaModal(false)} className="btn-secondary flex-1">Batal</button>
            <button onClick={sendWhatsApp} className="btn-primary flex-1 bg-green-600 hover:bg-green-700">
              <Send size={16} /> Kirim via WhatsApp
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Delete */}
      <ConfirmDialog
        open={!!deleteCustomerId}
        onClose={() => setDeleteCustomerId(null)}
        onConfirm={() => {
          if (deleteCustomerId) {
            const customerName = customers.find(c => c.id === deleteCustomerId)?.name || '';
            deleteCustomer(deleteCustomerId);
            if (currentUser) {
              addLog(currentUser.id, currentUser.name, currentUser.role, 'delete_customer', `Hapus pelanggan: ${customerName}`, { customerId: deleteCustomerId });
            }
          }
        }}
        title="Hapus Pelanggan"
        message="Yakin ingin menghapus pelanggan ini? Data kunjungan dan belanja akan hilang."
        confirmText="Ya, Hapus"
      />

      {/* BUG-16: PIN verification for non-Manager customer delete */}
      <PinModal
        open={!!pendingDeleteId}
        onClose={() => setPendingDeleteId(null)}
        onSuccess={() => {
          setDeleteCustomerId(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        title="Verifikasi PIN Manager"
      />

      {/* Floating Action Button (FAB) for Tambah Pelanggan */}
      <button
        onClick={openAdd}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-brand-600 hover:bg-brand-700 active:scale-95 shadow-2xl flex items-center justify-center text-white transition-all duration-300 hover:scale-105 border border-white/20 ring-4 ring-brand-500/20"
        title="Tambah Pelanggan"
      >
        <Plus size={28} />
      </button>
    </div>
  );
}
