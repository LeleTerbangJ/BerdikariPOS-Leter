// Data Model sesuai PRD Section 5

export type Role = 'Manager' | 'Kasir' | 'Acaraki' | 'Staf Gudang';

export interface User {
  id: string;
  name: string;
  username: string;
  password: string; // In MVP ini plain (future: hash)
  role: Role;
  createdAt: string;
  activeSessionId?: string;
}

export interface InventoryItem {
  id: string; // slug
  name: string;
  stock: number;
  unit: string; // kg, L, pcs, dll
  costPerUnit: number; // harga dasar untuk hitung HPP
  minStock?: number; // threshold alert (default 3)
}

export interface AddOn {
  name: string;
  price: number;
  hpp?: number; // optional cost of goods for this addon (untuk hitung HPP akurat)
  ingredients?: Record<string, number>; // { inventory_id: amount } resep bahan baku addon
}

export type ComponentType = 'Menu' | 'Inventory' | 'Modifier';
export type ComponentMode = 'Bundle' | 'Add-on';

export interface MenuComponent {
  id: string;
  parentMenuId: string;
  childType: ComponentType;
  childId: string;
  quantity: number;
  mode: ComponentMode;
  sortOrder?: number;
  createdAt?: string;

  // Resolved metadata for UI / Processing
  childName?: string;
  childPrice?: number;
  childCategory?: string;
  childKitchenTarget?: string;
  childIngredients?: Record<string, number>;
}

export interface BundleComponentSnapshot {
  componentId: string;
  childType: ComponentType;
  childId: string;
  childName: string;
  quantity: number;        // Qty per 1 bundle unit
  totalQuantity: number;   // quantity * bundleCartItem.quantity
  kitchenTarget?: string;
  ingredients?: Record<string, number>;
  recipeSnapshot?: RecipeIngredientSnapshot[];
}

export interface Menu {
  id: string;
  name: string;
  category: string;
  price: number;
  image?: string;
  isBestSeller?: boolean;
  isAvailable?: boolean; // default true, false = nonaktif sementara
  ingredients: Record<string, number>; // { inventory_id: amount }
  availableAddons: AddOn[];
  description?: string;
  manualHpp?: number;
  kitchenTarget?: string; // Target dapur/printer split (misal: "Bar", "Dapur Makanan", atau kosong/default)
  showSugarLevel?: boolean; // true = tampilkan level gula, false = sembunyikan
  showTemperature?: boolean; // true = tampilkan pilihan suhu, false = sembunyikan (untuk makanan)
  
  // BUNDLE SUPPORT
  isBundle?: boolean; // true = Paket / Bundle Menu
  components?: MenuComponent[];
}

export type Temperature = 'Hangat' | 'Dingin';
export type SugarLevel = 'Normal' | 'Less' | 'None';
export type PaymentMethod = 'Cash' | 'QRIS' | 'Transfer';
export type KitchenStatus = 'Waiting' | 'Processing' | 'Done';
export type TxStatus = 'Selesai' | 'Cancel' | 'Pending' | 'Demo';
export type OrderType = 'Dine In' | 'Take Away';

export interface RecipeIngredientSnapshot {
  inventoryId: string;
  inventoryName: string;
  unit: string;
  qty: number;          // Kebutuhan bahan per 1 unit item (misal 18 gram)
  totalQty: number;     // Total kebutuhan bahan pada transaksi (qty * item.quantity)
  unitCost: number;     // Cost per unit bahan baku saat checkout (costPerUnit)
  subtotalCost: number; // Total modal/HPP bahan ini (totalQty * unitCost)
  source?: 'menu' | 'addon';
  addonName?: string;
}

export interface CartItem {
  lineId: string; // unique per line
  menuId: string;
  name: string;
  basePrice: number;
  quantity: number;
  temperature: Temperature;
  sugar: SugarLevel;
  addons: AddOn[];
  subtotal: number; // (basePrice + sum(addons)) * qty
  kitchenTarget?: string; // target kitchen for split printing
  showSugarLevel?: boolean;
  showTemperature?: boolean;
  tableNumber?: string;
  // Snapshot Recipe & HPP (BOM at checkout time)
  recipeSnapshot?: RecipeIngredientSnapshot[];
  cogs?: number; // Total HPP / Cost of Goods Sold untuk item ini
  hpp?: number;  // Alias untuk cogs
  totalCogs?: number; // Alias untuk total hpp

  // BUNDLE SUPPORT
  isBundle?: boolean;       // true = Parent Bundle Menu
  isBundleChild?: boolean;  // true = Child item generated from Bundle
  parentLineId?: string;   // Line ID of parent Bundle item
  bundleComponentsSnapshot?: BundleComponentSnapshot[];
}

export type TransactionLifecycleState = 
  | 'PENDING'
  | 'VALIDATING'
  | 'PROCESSING'
  | 'COMMITTED'
  | 'SYNC_PENDING'
  | 'SYNCED'
  | 'FAILED'
  | 'ROLLED_BACK';

export interface Transaction {
  id: string;
  queueNumber: number;
  date: string; // ISO
  items: CartItem[];
  subtotal: number;
  discount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  cashReceived?: number;
  change?: number;
  kitchenStatus: KitchenStatus;
  txStatus: TxStatus;
  cashierId: string;
  cashierName: string;
  customerId?: string; // opsional (CRM)
  customerName?: string;
  hpp: number; // Total cost of goods sold (COGS) snapshot
  cogs?: number; // Alias untuk hpp (COGS)
  totalCogs?: number; // Alias untuk total hpp
  grossProfit?: number; // Laba kotor snapshot = Net Sales (subtotal - discount) - HPP
  tax?: number; // GAP-3 fix: Nilai pajak
  orderType?: 'Dine In' | 'Take Away'; // Tipe pesanan: makan di tempat atau bawa pulang
  tableNumber?: string; // Fitur nomor meja
  lifecycleState?: TransactionLifecycleState; // Atomic State Machine
  outletId?: string; // Multi-outlet enterprise extension

  // Properti Baru v4.1 (Pending & Split Bill)
  tableName?: string;            // Nomor Meja (contoh: "Meja 05")
  isPending?: boolean;           // Flag transaksi gantung
  pendingNotes?: string;         // Catatan khusus gantung
  splitParentId?: string;        // ID transaksi induk jika hasil split bill
  splitIndex?: number;           // Urutan sub-bill (contoh: 1 dari 2)
  totalSplitCount?: number;      // Total bagian split (contoh: 2)
  paidAmount?: number;           // Nominal yang sudah dibayar pada partial split

  // v4.5 TO DO 5.5: promo/voucher yang dipakai saat pending disimpan — di-restore saat resume
  // agar totalAmount final konsisten dengan nominal pending (lintas restart / device).
  appliedPromoId?: string;       // ID promo yang diterapkan
  voucherCode?: string;          // Kode voucher (untuk ditampilkan ulang saat resume)

  // v4.7 TO DO 12.2.4 (P-A3): snapshot performa promo — NAMA & nominal diskon promo saat
  // checkout di-snapshot agar laporan performa promo akurat walau promo diedit/dihapus nanti.
  promoName?: string;            // Nama promo (snapshot saat checkout)
  promoAmount?: number;          // Nominal diskon promo yang diterapkan (snapshot saat checkout)

  // v4.7 TO DO 11.2 (P0.2): refund/retur penuh — transaksi Selesai yang dikembalikan.
  // Stok & kunjungan pelanggan sudah di-revert saat refund; Kas Keluar 'Refund' dicatat
  // di Rekap Kas (akuntabel). Transaksi refunded TIDAK dihitung sebagai penjualan di laporan.
  refunded?: boolean;            // true = sudah di-refund (guard anti double-refund & double-revert)
  refundedAt?: string;           // ISO timestamp refund
  refundedAmount?: number;       // Nominal yang dikembalikan (full = totalAmount)
  refundNote?: string;           // Catatan/alasan refund
  refundedById?: string;         // User yang mengotorisasi refund
  refundedByName?: string;       // Nama approver refund
}

export interface AtomicCheckoutParams {
  transactionId?: string;
  cartItems: CartItem[];
  subtotal: number;
  discount: number;
  taxAmount: number;
  totalAmount: number;
  payMethod: PaymentMethod;
  cashReceived?: number;
  orderType?: OrderType;
  tableNumber?: string;
  selectedCustomerId?: string;
  selectedCustomerName?: string;
  currentUser?: { id: string; name: string; role: string } | null;
  settings: any;
  preOpenedPrintWindow?: Window | null;
  // v4.7 TO DO 15.3: opsi "cetak tanpa struk" per-transaksi — dua toggle independen:
  // skipReceiptPrint = true → struk kasir TIDAK dicetak (tiket dapur tetap bisa keluar);
  // skipKitchenPrint = true → tiket dapur TIDAK dicetak (anti tiket dobel saat resume pending).
  skipReceiptPrint?: boolean;
  skipKitchenPrint?: boolean;

  // v4.1 Extensions for Pending & Split
  skipStockDeduction?: boolean;  // If true, bypass inventory deduction (prevent double deduction)
  reservedDeductions?: Record<string, number>; // Stok yang sudah di-reserve dari pesanan pending → deduksi DELTA saat resume/update/finalize
  bypassIdempotency?: boolean;   // Izinkan re-commit dengan ID transaksi yang sama (resume/update/finalize pending)
  overrideKitchenStatus?: KitchenStatus; // Pertahankan status dapur (jangan reset ke Waiting) saat finalisasi/update pending
  overrideTxStatus?: TxStatus;   // 'Pending' or 'Selesai'
  overrideQueueNumber?: number; // Preserve existing queue number when finalizing pending
  pendingNotes?: string;
  splitParentId?: string;
  splitIndex?: number;
  totalSplitCount?: number;
  suppressAutoPrint?: boolean; // Cegah cetak otomatis struk/tiket di post-commit (dipakai sub-bill split yang mengelola print sendiri)
  // v4.5 TO DO 5.2: Skala HPP transaksi (mis. 1/N untuk sub-bill split mode Equal yang membawa
  // SEMUA item cart). Tanpa ini, Σ hpp sub-bill equal ter-inflasi N× di laporan Laba Kotor.
  // Engine: tx.hpp = Math.round(totalHpp * scaleHpp).
  scaleHpp?: number;
  // v4.5 TO DO 5.5: rekam promo/voucher pada transaksi PENDING (di-restore saat resume)
  appliedPromoId?: string;
  voucherCode?: string;
  // v4.7 TO DO 12.2.4 (P-A3): snapshot nama & nominal diskon promo saat checkout
  promoName?: string;
  promoAmount?: number;
}

// Split Bill Interfaces
export type SplitBillMode = 'equal' | 'item';

export interface SubBill {
  id: string;
  index: number; // 1, 2, 3...
  items: CartItem[];
  subtotal: number;
  discount: number;
  tax: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  cashReceived?: number;
  change?: number;
  isPaid: boolean;
  paidAt?: string;
  transactionId?: string; // Linked sub-transaction ID
}

export interface SplitBillSession {
  parentTxId: string;
  mode: SplitBillMode;
  splitCount: number;
  bills: SubBill[];
}

export interface AtomicCheckoutResult {
  success: boolean;
  transaction?: Transaction;
  error?: string;
  warnings?: {
    ingredientId: string;
    ingredientName: string;
    required: number;
    available: number;
    unit: string;
  }[];
  idempotentReplay?: boolean;
}

// CRM (extension beyond PRD MVP)
export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  totalSpent: number;
  visitCount: number;
  // v4.7 TO DO 12.2.2 (P-A8): poin loyalty — didapat saat checkout (earn) & bisa ditukar jadi
  // diskon (redeem). Dihitung dari LoyaltySettings.pointsPerTransaction + total/pointsPerRupiah.
  loyaltyPoints?: number;
  lastVisit?: string;
  createdAt: string;
}

export interface KitchenPrinterConfig {
  id: string;
  name: string; // nama printer, misal: "Printer Bar" atau "Printer Dapur Makanan"
  targetCategory: string; // kategori target menu, misal: "Minuman" atau "Makanan"
  enabled: boolean;
  type: 'browser' | 'bluetooth';
  width: '58mm' | '80mm';
  bluetoothDeviceId?: string;    // Web Bluetooth device.id — persistent identifier
  bluetoothDeviceName?: string;  // Human-readable Bluetooth device name
  // TO DO 14.5: fallback eksplisit per printer — true = bila koneksi Bluetooth gagal,
  // tiket dicetak lewat dialog browser (window.print). Default true saat undefined.
  fallbackBrowser?: boolean;
}

export interface AppSettings {
  managerPin: string;
  storeName: string;
  storeLogo?: string; // base64 data URL
  address?: string;
  taxEnabled?: boolean; // toggle on/off fitur pajak
  taxPercent?: number; // persentase pajak (misal 10%, 11%, dll)
  categories: string[]; // daftar kategori menu
  // Printer settings
  printerEnabled: boolean;
  printerType: 'browser' | 'bluetooth'; // browser = window.print, bluetooth = Web Bluetooth API
  printerWidth: '58mm' | '80mm';
  autoPrintOnCheckout: boolean;
  cashierBluetoothDeviceId?: string;    // Bluetooth device.id for cashier printer
  cashierBluetoothDeviceName?: string;  // Bluetooth device name for cashier printer
  // TO DO 14.5: fallback eksplisit ke browser print bila koneksi Bluetooth kasir gagal.
  // Device-local (tidak disinkronkan ke cloud, seperti printerType/printerWidth). Default true.
  cashierFallbackBrowser?: boolean;
  kitchenPrinters?: KitchenPrinterConfig[]; // Konfigurasi printer dapur untuk split print
  // Super Admin & Demo
  superAdminPin: string; // PIN untuk akses Manajemen Data (hanya developer)
  demoMode: boolean; // true = tampilkan demo accounts di login
  // UI Theme Settings
  themeColor?: string;
  themeShades?: {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
  };
  tableFeaturesEnabled?: boolean;
  availableTableNumbers?: string[];
  // Receipt Customization (v3.7 & v4.0)
  receiptHeader?: string;
  receiptFooter?: string;
  receiptAsciiOnly?: boolean;
  autoPrintReceipt?: boolean;
  autoPrintKitchen?: boolean;
  showLogoOnReceipt?: boolean;
  // v4.7 TO DO 11.2 (P0.4): struk digital — kirim otomatis struk ke WhatsApp pelanggan
  // setelah checkout berhasil (hanya jika transaksi punya pelanggan dengan nomor HP valid).
  autoSendDigitalReceipt?: boolean;
}

// Cash Movement (Rekap Kas: Kas Masuk & Kas Keluar)
export type CashMovementType = 'in' | 'out'; // 'in' = Kas Masuk, 'out' = Kas Keluar

export interface CashMovement {
  id: string;
  shiftId?: string;
  type: CashMovementType;
  amount: number;
  category: string; // e.g. 'Modal Tambahan', 'Pembelian Bahan', 'Operasional Toko', 'Lain-lain'
  notes?: string;
  cashierId: string;
  cashierName: string;
  date: string; // ISO String
  createdAt: string;
}

// Shift Management
export interface CashierShift {
  id: string;
  userId: string;
  userName: string;
  openedAt: string; // ISO
  closedAt?: string; // ISO
  openingCash: number; // modal awal
  closingCash?: number; // kas akhir di laci (input manual)
  expectedCash?: number; // kalkulasi sistem (opening + cash sales + cashIn - cashOut)
  cashDifference?: number; // closingCash - expectedCash
  totalSales: number;
  totalTransactions: number;
  status: 'open' | 'closed';
}


// Promo & Voucher
export type PromoType = 'percentage' | 'fixed' | 'bogo'; // persentase, nominal tetap, atau BOGO (beli N gratis M)
export type PromoScope = 'all' | 'category' | 'menu' | 'loyalty'; // berlaku untuk apa

export interface Promo {
  id: string;
  name: string;
  code?: string; // voucher code (opsional)
  type: PromoType;
  value: number; // persentase (0-100) atau nominal Rp
  scope: PromoScope;
  scopeTarget?: string; // category name atau menu id (jika scope bukan 'all')
  minPurchase?: number; // minimal belanja
  maxDiscount?: number; // maks potongan (untuk persentase)
  startDate: string; // ISO
  endDate: string; // ISO
  isActive: boolean;
  usageLimit?: number; // maks penggunaan
  usageCount: number; // sudah dipakai berapa kali
  loyaltyMinVisits?: number; // min kunjungan untuk promo loyalty
  // v4.7 TO DO 12.2.3 (P-A4): boleh digabung dengan diskon lain (manual/loyalty)?
  // undefined = true (legacy: perilaku lama yang menumpuk semua diskon).
  // false = promo EKSKLUSIF → mesin diskon POS otomatis memberi best-deal
  // (pelanggan dapat yang lebih besar antara promo vs manual+loyalty, tidak keduanya).
  stackable?: boolean;

  // v4.7 TO DO 12.2.5 (P-A5): BOGO & min-qty
  // BOGO (type='bogo'): beli `bogoBuyQty` → gratis `bogoFreeQty` unit; `bogoPercent` = diskon %
  // per unit gratis (0/undefined = gratis penuh, mis. 50 = item ke-N diskon 50%).
  bogoBuyQty?: number;   // beli N (min 2)
  bogoFreeQty?: number;  // gratis M (min 1, default 1)
  bogoPercent?: number;  // diskon % per unit gratis (0-100)
  // Min-qty discount (type percentage/fixed): diskon hanya berlaku bila total qty item target
  // (scope menu/category, atau seluruh keranjang bila scope all) >= minQty.
  minQty?: number;

  // v4.7 TO DO 12.2.6 (P-A6): batas pemakaian PER PELANGGAN
  // usageLimitPerCustomer = maks pemakaian per pelanggan (mis. 1 = "1 voucher per pelanggan").
  // Mewajibkan pelanggan terpilih di POS saat promo diterapkan (tanpa pelanggan → tidak berlaku).
  usageLimitPerCustomer?: number;
  // Pencatatan pemakaian per pelanggan: { customerId: jumlahPakai }. Disinkronkan bersama promo
  // (pola sama dengan usageCount global). undefined = belum pernah dipakai.
  usageByCustomer?: Record<string, number>;
  createdAt: string;
}

// Loyalty
export interface LoyaltySettings {
  enabled: boolean;
  pointsPerTransaction: number; // poin per transaksi
  pointsPerRupiah: number; // poin per Rp (misal 1 poin per 10000)
  redeemPointsValue: number; // 1 poin = berapa Rp diskon
  tierBronzeMinVisits: number;
  tierSilverMinVisits: number;
  tierGoldMinVisits: number;
  tierBronzeDiscount: number; // % diskon
  tierSilverDiscount: number;
  tierGoldDiscount: number;
}

// Audit Log
export type AuditAction =
  | 'login' | 'logout'
  | 'create_transaction' | 'void_transaction' | 'delete_transaction'
  // v4.7 TO DO 11.2 (P0.2): refund/retur penuh
  | 'refund_transaction'
  // v4.7 TO DO 11.2 (P0.4): struk digital (WA/email)
  | 'send_digital_receipt'
  // v4.7 TO DO 12.1.3 / P-A1: aksi reset/manajemen data (dicatat ke cloud agar survive reload)
  | 'reset_data'
  | 'create_menu' | 'update_menu' | 'delete_menu' | 'toggle_menu'
  | 'create_user' | 'update_user' | 'delete_user'
  | 'create_inventory' | 'update_inventory' | 'delete_inventory' | 'deduct_inventory'
  | 'open_shift' | 'close_shift'
  | 'update_settings' | 'create_promo' | 'update_promo' | 'delete_promo'
  | 'create_customer' | 'update_customer' | 'delete_customer'
  | 'update_cash_movement' | 'delete_cash_movement'
  | 'stock_opname'
  // v4.7 TO DO 13.2 (O-3): operasi sync yang gagal permanen (retry / dihapus dari daftar)
  | 'sync_failed' | 'sync_retry' | 'sync_failed_cleared';

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  userRole: Role;
  action: AuditAction;
  detail: string;
  timestamp: string; // ISO
  metadata?: Record<string, any>;
}

// Stock Opname (Stock Taking / Physical Inventory Count)
export interface StockOpnameItem {
  inventoryId: string;
  inventoryName: string;
  unit: string;
  systemStock: number;    // Stok Buku (Sistem) saat opname dimulai
  actualStock: number;    // Stok Fisik (dihitung staf)
  difference: number;     // actualStock - systemStock (+ lebih / - kurang)
  costPerUnit: number;    // harga per unit untuk hitung kerugian
  lossValue: number;      // Math.abs(difference) * costPerUnit (jika selisih negatif)
  reason: string;         // Alasan penyesuaian (e.g. "Basi", "Bahan Rusak", "Salah Input")
}

export interface StockOpname {
  id: string;
  date: string;           // ISO timestamp
  staffId: string;        // ID user yang melakukan opname
  staffName: string;      // Nama staf penginput
  items: StockOpnameItem[];
  totalLossValue: number; // Total kerugian
  totalItems: number;     // Jumlah item yang diopname
  itemsWithDifference: number; // Jumlah item yang ada selisih
  pinVerified: boolean;   // Apakah PIN Manager sudah diverifikasi (wajib jika ada selisih besar)

  // v4.7 TO DO 10.2: identitas approver + jejak audit (dual-control).
  // PIN/approval hanya bisa dari akun Manager/Owner; identitas dicatat TERPISAH dari
  // staffId (staff penginput) karena approval diketik manager di perangkat staff.
  approverId?: string;    // ID user Manager yang menyetujui
  approverName?: string;  // Nama approver
  approverRole?: string;  // Role approver (selalu 'Manager')
  approvedAt?: string;    // ISO timestamp saat approval berhasil
  deviceId?: string;      // Penanda perangkat tempat approval terjadi

  // v4.7 TO DO 10.3: alasan utama wajib untuk Staf Gudang setelah PIN disetujui
  // (mode buta — alasan per-item tidak praktis karena staff tidak tahu item yang berselisih).
  adjustmentReason?: string;

  notes?: string;         // Catatan tambahan
}
