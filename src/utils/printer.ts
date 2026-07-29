/**
 * Thermal Printer Utility — v4.0 (Printer Device Registry)
 * 
 * Supports two modes:
 * 1. Browser Print — opens a styled print window optimized for thermal paper
 * 2. Bluetooth ESC/POS — connects to thermal printer via Web Bluetooth API
 * 
 * v4.0: Each logical printer (cashier, kitchen-food, kitchen-drink) has its own
 * independent Bluetooth device binding via a Printer Device Registry.
 */

import type { AppSettings, Transaction, CartItem, KitchenPrinterConfig } from '../types';
import { formatRupiah } from './format';

// ============================================================
// RECEIPT DATA TYPES
// ============================================================

export interface ReceiptData {
  storeName: string;
  storeAddress?: string;
  storeLogo?: string;
  queueNumber: number;
  date: string;
  cashierName: string;
  customerName?: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  tax?: number;
  total: number;
  paymentMethod: string;
  cashReceived?: number;
  change?: number;
  orderType?: 'Dine In' | 'Take Away';
  tableNumber?: string;
  receiptHeader?: string;
  receiptFooter?: string;
  isReprint?: boolean;
  showLogoOnReceipt?: boolean;
}

export function buildReceiptFromTransaction(tx: Transaction, settings: AppSettings, isReprint: boolean = false): ReceiptData {
  return {
    storeName: settings.storeName,
    storeAddress: settings.address,
    storeLogo: settings.storeLogo,
    queueNumber: tx.queueNumber,
    date: tx.date,
    cashierName: tx.cashierName,
    customerName: tx.customerName,
    items: tx.items,
    subtotal: tx.subtotal,
    discount: tx.discount,
    tax: tx.tax,
    total: tx.totalAmount,
    paymentMethod: tx.paymentMethod,
    cashReceived: tx.cashReceived,
    change: tx.change,
    orderType: tx.orderType,
    tableNumber: tx.tableNumber,
    receiptHeader: settings.receiptHeader,
    receiptFooter: settings.receiptFooter,
    isReprint,
    showLogoOnReceipt: settings.showLogoOnReceipt !== false,
  };
}

// ============================================================
// PRINTER DEVICE REGISTRY (Multiple Bluetooth Connections)
// ============================================================

interface BluetoothConnection {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
  deviceName: string;
  deviceId: string;
}

export interface PrinterStatus {
  printerId: string;
  connected: boolean;
  deviceName?: string;
  deviceId?: string;
}

export interface PrintJobResult {
  printer: string;
  status: 'success' | 'error';
  error?: string;
}

/**
 * Registry: Maps a logical printer ID to its Bluetooth connection.
 * - '__cashier__' → Cashier receipt printer
 * - '<kitchen-printer-uuid>' → Kitchen/bar printer
 */
const printerRegistry = new Map<string, BluetoothConnection>();
export const CASHIER_PRINTER_ID = '__cashier__';

// ============================================================
// BLUETOOTH CONNECTION MANAGEMENT
// ============================================================

/**
 * Connect a Bluetooth printer and register it under a specific printer ID.
 * Each call opens the browser's Bluetooth device picker independently.
 */
export async function connectBluetoothPrinter(
  printerId: string = CASHIER_PRINTER_ID
): Promise<{ success: boolean; deviceId?: string; deviceName?: string }> {
  try {
    if (!navigator.bluetooth) {
      alert('Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome atau Edge.');
      return { success: false };
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: ['000018f0-0000-1000-8000-00805f9b34fb'] },
      ],
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb',
        '0000ff00-0000-1000-8000-00805f9b34fb',
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
      ],
    });

    if (!device) return { success: false };

    const gatt = device.gatt;
    if (!gatt) {
      alert('Printer tidak mendukung GATT. Coba pairing ulang.');
      return { success: false };
    }
    const server = await gatt.connect();

    // Try common thermal printer services
    const serviceUUIDs = [
      '000018f0-0000-1000-8000-00805f9b34fb',
      '0000ff00-0000-1000-8000-00805f9b34fb',
      'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    ];

    for (const uuid of serviceUUIDs) {
      try {
        const service = await server.getPrimaryService(uuid);
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            // Register connection under this printerId
            printerRegistry.set(printerId, {
              device,
              characteristic: char,
              deviceName: device.name || 'Unknown Printer',
              deviceId: device.id,
            });

            // Listen for disconnection
            device.addEventListener('gattserverdisconnected', () => {
              printerRegistry.delete(printerId);
              console.log(`[PrinterRegistry] ${printerId} disconnected (${device.name})`);
            });

            return {
              success: true,
              deviceId: device.id,
              deviceName: device.name || 'Unknown Printer',
            };
          }
        }
      } catch {
        continue;
      }
    }

    alert('Printer ditemukan tapi tidak bisa menulis. Pastikan printer thermal Bluetooth kompatibel.');
    return { success: false };
  } catch (err: any) {
    if (err.name !== 'NotFoundError') {
      console.error('Bluetooth error:', err);
      alert(`Gagal connect: ${err.message}`);
    }
    return { success: false };
  }
}

/**
 * Check if a specific printer is connected.
 */
export function isBluetoothConnected(printerId: string = CASHIER_PRINTER_ID): boolean {
  const conn = printerRegistry.get(printerId);
  return !!(conn?.device?.gatt?.connected && conn?.characteristic);
}

/**
 * Get the status of a specific printer.
 */
export function getBluetoothStatus(printerId: string = CASHIER_PRINTER_ID): PrinterStatus {
  const conn = printerRegistry.get(printerId);
  const connected = !!(conn?.device?.gatt?.connected && conn?.characteristic);
  return {
    printerId,
    connected,
    deviceName: connected ? conn?.deviceName : undefined,
    deviceId: connected ? conn?.deviceId : undefined,
  };
}

/**
 * Disconnect a specific printer from the registry.
 */
export async function disconnectBluetoothPrinter(printerId: string = CASHIER_PRINTER_ID) {
  const conn = printerRegistry.get(printerId);
  if (conn?.device?.gatt?.connected) {
    conn.device.gatt.disconnect();
  }
  printerRegistry.delete(printerId);
}

/**
 * Check if a Bluetooth device is already used by another printer in the registry.
 * Returns the printer ID and name that's using the device, or null.
 */
export function getDuplicateDeviceInfo(
  deviceId: string,
  excludePrinterId: string,
  settings: AppSettings
): { printerId: string; printerName: string } | null {
  for (const [regId, conn] of printerRegistry.entries()) {
    if (regId !== excludePrinterId && conn.deviceId === deviceId) {
      // Find human-readable name
      let printerName = 'Printer Kasir';
      if (regId !== CASHIER_PRINTER_ID) {
        const kp = (settings.kitchenPrinters || []).find(p => p.id === regId);
        printerName = kp?.name || regId;
      }
      return { printerId: regId, printerName };
    }
  }
  return null;
}

/**
 * Get statuses for all registered printers (for UI display).
 */
export function getAllPrinterStatuses(): PrinterStatus[] {
  const statuses: PrinterStatus[] = [];
  for (const [id, conn] of printerRegistry.entries()) {
    const connected = !!(conn.device?.gatt?.connected && conn.characteristic);
    statuses.push({
      printerId: id,
      connected,
      deviceName: conn.deviceName,
      deviceId: conn.deviceId,
    });
  }
  return statuses;
}

// ============================================================
// INTERNAL: Send ESC/POS byte data to a specific printer
// ============================================================

async function sendToBluetoothPrinter(printerId: string, data: Uint8Array): Promise<void> {
  const conn = printerRegistry.get(printerId);
  if (!conn || !conn.characteristic) {
    throw new Error(`Printer "${printerId}" tidak terhubung.`);
  }

  // Verify GATT is still connected
  if (!conn.device.gatt?.connected) {
    printerRegistry.delete(printerId);
    throw new Error(`Koneksi Bluetooth ke printer "${conn.deviceName}" terputus.`);
  }

  const chunkSize = 20;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    if (conn.characteristic.properties.writeWithoutResponse) {
      await conn.characteristic.writeValueWithoutResponse(chunk);
    } else {
      await conn.characteristic.writeValue(chunk);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ============================================================
// ============================================================
// MONOCHROME (BLACK & WHITE) LOGO CONVERSION FOR THERMAL PRINT
// ============================================================

/**
 * Convert any image (URL or Base64) into a 1-bit Black & White monochrome canvas.
 * Transparent PNG backgrounds become crisp white, colored pixels are thresholded to black/white.
 */
export function getMonochromeLogoCanvas(src: string, targetWidth = 160): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => reject(new Error('Gagal memuat logo'));
    img.onload = () => {
      // Scale image to compact targetWidth suitable for thermal receipt headers (~20mm width)
      const scale = targetWidth / Math.max(img.width, 1);
      const width = Math.max(8, Math.round(img.width * scale));
      const height = Math.max(8, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(canvas);
        return;
      }

      // White background for transparent PNG logos
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;

      // Convert to 1-bit Black & White (Grayscale + High-Contrast Thresholding)
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const alpha = data[i + 3];

        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const bw = (gray < 165 && alpha > 128) ? 0 : 255;

        data[i] = bw;
        data[i + 1] = bw;
        data[i + 2] = bw;
        data[i + 3] = 255;
      }

      ctx.putImageData(imgData, 0, 0);
      resolve(canvas);
    };
    img.src = src;
  });
}

/**
 * Convert Canvas bitmap into ESC/POS GS v 0 raster bit image commands.
 */
export function convertCanvasToESCPOSRaster(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array(0);

  const width = canvas.width;
  const height = canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const bytesWidth = Math.ceil(width / 8);
  const commands: number[] = [];

  const xL = bytesWidth & 0xFF;
  const xH = (bytesWidth >> 8) & 0xFF;
  const yL = height & 0xFF;
  const yH = (height >> 8) & 0xFF;

  // Center align logo
  commands.push(0x1B, 0x61, 0x01);
  // GS v 0 0 xL xH yL yH
  commands.push(0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < bytesWidth; x++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const px = x * 8 + bit;
        if (px < width) {
          const idx = (y * width + px) * 4;
          const r = data[idx];
          if (r < 128) {
            byte |= (0x80 >> bit);
          }
        }
      }
      commands.push(byte);
    }
  }

  commands.push(0x0A); // Line feed after logo
  return new Uint8Array(commands);
}

// ============================================================
// MODE 1: BROWSER PRINT (window.print)
// ============================================================

export function printReceiptBrowser(data: ReceiptData, width: '58mm' | '80mm', preOpenedWindow?: Window | null) {
  const fontSize = width === '58mm' ? '11px' : '12px';
  const paperWidth = width === '58mm' ? '48mm' : '72mm';
  const dateStr = formatDateShort(data.date);

  const itemsHtml = data.items.map((item) => {
    if (item.isBundleChild) {
      return `
        <div style="font-size: 85%; color: #555; padding-left: 12px; margin-bottom: 2px;">
          - ${item.quantity}x ${item.name}
        </div>
      `;
    }

    const addonStr = item.addons.length > 0 ? ` +${item.addons.map(a => a.name).join(',')}` : '';
    const sugarStr = item.showSugarLevel !== false ? `/${item.sugar}` : '';
    const tempStr = item.showTemperature !== false ? item.temperature : '';
    const detailStr = `${tempStr}${sugarStr}${addonStr}`.trim();
    const unitPrice = item.basePrice + item.addons.reduce((a, b) => a + b.price, 0);

    return `
      <div class="item-row">
        <div class="font-bold">${item.name} ${item.isBundle ? '<span style="font-size: 80%; font-weight: normal;">(Paket)</span>' : ''}</div>
        ${detailStr ? `<div class="item-details">${detailStr}</div>` : ''}
        <div class="flex-between">
          <span style="padding-left: 4px;">${item.quantity}x ${formatRupiah(unitPrice)}</span>
          <span class="font-bold">${formatRupiah(item.subtotal)}</span>
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Struk #${data.queueNumber}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Courier New', Courier, monospace;
          font-size: ${fontSize};
          width: ${paperWidth};
          margin: 0 auto;
          padding: 4mm 2mm;
          color: #000;
          background: #fff;
          line-height: 1.3;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .font-bold { font-weight: bold; }
        .uppercase { text-transform: uppercase; }
        .divider { border-bottom: 1px dashed #000; margin: 6px 0; }
        .flex-between { display: flex; justify-content: space-between; align-items: flex-start; }
        .item-row { margin-bottom: 5px; }
        .item-details { font-size: 90%; color: #444; padding-left: 4px; }
        .logo-container { text-align: center; margin-bottom: 6px; }
        .logo-img { max-height: 45px; max-width: 130px; width: auto; height: auto; object-fit: contain; margin: 0 auto; display: block; filter: grayscale(100%) contrast(200%); }
        @media print {
          @page { margin: 0; size: ${width} auto; }
          body { width: 100%; padding: 2mm; }
        }
      </style>
    </head>
    <body>
      ${data.storeLogo && data.showLogoOnReceipt !== false ? `<div class="logo-container"><img id="receipt-logo" src="${data.storeLogo}" class="logo-img" alt="Logo" /></div>` : ''}
      
      ${data.isReprint ? `<div class="text-center font-bold">*** CETAK ULANG ***</div>` : ''}
      <div class="text-center font-bold uppercase" style="font-size: 110%;">${data.storeName}</div>
      ${data.storeAddress ? `<div class="text-center" style="font-size: 90%;">${data.storeAddress}</div>` : ''}
      ${data.receiptHeader ? `<div class="text-center" style="font-size: 90%; margin-top: 2px;">${data.receiptHeader}</div>` : ''}
      
      <div class="divider"></div>
      
      <div class="flex-between" style="font-size: 95%;">
        <div>
          <div>No: #${data.queueNumber}</div>
          <div>Tgl: ${dateStr}</div>
          <div>Kasir: ${data.cashierName}</div>
          ${data.customerName ? `<div>Pelanggan: ${data.customerName}</div>` : ''}
        </div>
        <div class="text-right font-bold uppercase">
          ${data.orderType ? `<div>${data.orderType}</div>` : ''}
          ${data.tableNumber ? `<div>${data.tableNumber}</div>` : ''}
        </div>
      </div>
      
      <div class="divider"></div>
      
      <div style="margin: 4px 0;">
        ${itemsHtml}
      </div>
      
      <div class="divider"></div>
      
      <div style="font-size: 95%;">
        <div class="flex-between"><span>Subtotal</span><span>${formatRupiah(data.subtotal)}</span></div>
        ${data.discount > 0 ? `<div class="flex-between"><span>Diskon</span><span>-${formatRupiah(data.discount)}</span></div>` : ''}
        ${data.tax && data.tax > 0 ? `<div class="flex-between"><span>Pajak</span><span>${formatRupiah(data.tax)}</span></div>` : ''}
        <div class="flex-between font-bold" style="font-size: 105%; margin-top: 2px;"><span>TOTAL</span><span>${formatRupiah(data.total)}</span></div>
      </div>
      
      <div class="divider"></div>
      
      <div style="font-size: 95%;">
        <div class="flex-between"><span>Bayar (${data.paymentMethod})</span><span>${formatRupiah(data.cashReceived || data.total)}</span></div>
        ${data.paymentMethod === 'Cash' && data.change !== undefined ? `<div class="flex-between"><span>Kembali</span><span>${formatRupiah(data.change)}</span></div>` : ''}
      </div>
      
      <div class="divider"></div>
      
      <div class="text-center" style="margin-top: 6px; font-size: 90%;">
        ${data.receiptFooter ? data.receiptFooter : 'Terima kasih atas kunjungan Anda!'}
      </div>

      <script>
        function triggerPrint() {
          window.focus();
          window.print();
          setTimeout(function() { window.close(); }, 1200);
        }
        window.onload = function() {
          var img = document.getElementById('receipt-logo');
          if (img) {
            if (img.complete && img.naturalWidth !== 0) {
              triggerPrint();
            } else {
              img.onload = triggerPrint;
              img.onerror = triggerPrint;
              setTimeout(triggerPrint, 1000);
            }
          } else {
            triggerPrint();
          }
        };
      </script>
    </body>
    </html>
  `;

  // Use pre-opened window if available, otherwise open a new one
  const printWindow = preOpenedWindow || window.open('', '_blank', 'width=400,height=600');
  if (!printWindow) {
    console.warn('[printReceiptBrowser] Pop-up blocked. Please allow pop-ups for this site.');
    return;
  }

  printWindow.document.write(html);
  printWindow.document.close();
}

// ============================================================
// MODE 2: BLUETOOTH ESC/POS — Cashier Receipt
// ============================================================

async function buildReceiptESCPOS(data: ReceiptData, width: '58mm' | '80mm'): Promise<Uint8Array> {
  const maxChars = width === '58mm' ? 32 : 42;
  const encoder = new TextEncoder();
  const ESC = 0x1B;
  const GS = 0x1D;
  const commands: number[] = [];

  // Initialize printer
  commands.push(ESC, 0x40);

  // 1. Monochromatic Logo Printing (converted to B&W 1-bit raster image)
  if (data.showLogoOnReceipt !== false && data.storeLogo) {
    try {
      const targetPixelWidth = width === '58mm' ? 160 : 220;
      const monoCanvas = await getMonochromeLogoCanvas(data.storeLogo, targetPixelWidth);
      const rasterBytes = convertCanvasToESCPOSRaster(monoCanvas);
      commands.push(...rasterBytes);
    } catch (e) {
      console.warn('[ESCPOS] Logo conversion failed, printing text only:', e);
    }
  }

  // 2. Header
  if (data.isReprint) {
    commands.push(ESC, 0x61, 0x01); // Center align
    commands.push(...encoder.encode('*** CETAK ULANG ***\n'));
  }

  // Center align + Bold store name
  commands.push(ESC, 0x61, 0x01);
  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode(data.storeName + '\n'));
  commands.push(ESC, 0x45, 0x00);

  if (data.storeAddress) {
    commands.push(...encoder.encode(data.storeAddress + '\n'));
  }
  if (data.receiptHeader) {
    commands.push(...encoder.encode(data.receiptHeader + '\n'));
  }

  // Left align
  commands.push(ESC, 0x61, 0x00);
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // 3. Transaction Info (Exact Left/Right Alignment)
  const orderHeader = getOrderTypeHeaderLines(data.orderType, data.tableNumber);
  const formattedDate = formatDateShort(data.date);

  const line1 = leftRight(`No: #${data.queueNumber}`, orderHeader.line1, width);
  commands.push(...encoder.encode(line1 + '\n'));

  const dateLeft = `Tgl: ${formattedDate}`;
  const rightTag = orderHeader.line2 || '';
  const line2 = leftRight(dateLeft, rightTag, width);
  commands.push(...encoder.encode(line2 + '\n'));

  commands.push(...encoder.encode(`Kasir: ${data.cashierName}\n`));
  if (data.customerName) {
    commands.push(...encoder.encode(`Pelanggan: ${data.customerName}\n`));
  }
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // 4. Items List (Exact Left/Right Alignment)
  for (const item of data.items) {
    commands.push(...encoder.encode(`${item.name}\n`));
    const addonStr = item.addons.length > 0 ? ` +${item.addons.map(a => a.name).join(',')}` : '';
    const sugarStr = item.showSugarLevel !== false ? `/${item.sugar}` : '';
    const tempStr = item.showTemperature !== false ? item.temperature : '';
    const detailStr = `${tempStr}${sugarStr}${addonStr}`.trim();
    if (detailStr) {
      commands.push(...encoder.encode(`  ${detailStr}\n`));
    }

    const unitPrice = item.basePrice + item.addons.reduce((a, b) => a + b.price, 0);
    const qtyPriceStr = `  ${item.quantity}x ${formatRupiah(unitPrice)}`;
    const subtotalStr = formatRupiah(item.subtotal);
    commands.push(...encoder.encode(leftRight(qtyPriceStr, subtotalStr, width) + '\n'));
  }

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // 5. Totals (Exact Left/Right Alignment)
  commands.push(...encoder.encode(leftRight('Subtotal', formatRupiah(data.subtotal), width) + '\n'));
  if (data.discount > 0) {
    commands.push(...encoder.encode(leftRight('Diskon', `-${formatRupiah(data.discount)}`, width) + '\n'));
  }
  if (data.tax && data.tax > 0) {
    commands.push(...encoder.encode(leftRight('Pajak', formatRupiah(data.tax), width) + '\n'));
  }

  // Bold TOTAL
  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode(leftRight('TOTAL', formatRupiah(data.total), width) + '\n'));
  commands.push(ESC, 0x45, 0x00);

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // Payment & Change (Exact Left/Right Alignment)
  const payLabel = `Bayar (${data.paymentMethod})`;
  const payVal = formatRupiah(data.cashReceived || data.total);
  commands.push(...encoder.encode(leftRight(payLabel, payVal, width) + '\n'));

  if (data.paymentMethod === 'Cash' && data.change !== undefined) {
    commands.push(...encoder.encode(leftRight('Kembali', formatRupiah(data.change), width) + '\n'));
  }

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // 6. Footer (Centered & Wrapped to prevent line overflow)
  commands.push(ESC, 0x61, 0x01); // Center align
  const rawFooter = data.receiptFooter || 'Terima kasih atas kunjungan Anda!';
  const wrappedFooterLines = wrapCenterLines(rawFooter, width);
  commands.push(...encoder.encode('\n' + wrappedFooterLines.join('\n') + '\n\n'));

  // Feed and cut
  commands.push(ESC, 0x64, 0x04);
  commands.push(GS, 0x56, 0x00);

  return new Uint8Array(commands);
}

async function printReceiptBluetooth(data: ReceiptData, width: '58mm' | '80mm') {
  if (!isBluetoothConnected(CASHIER_PRINTER_ID)) {
    const result = await connectBluetoothPrinter(CASHIER_PRINTER_ID);
    if (!result.success) return;
  }

  const escposData = await buildReceiptESCPOS(data, width);
  await sendToBluetoothPrinter(CASHIER_PRINTER_ID, escposData);
}

// ============================================================
// KITCHEN TICKET — Browser Print
// ============================================================

export function printKitchenReceiptBrowser(data: ReceiptData, items: CartItem[], kp: KitchenPrinterConfig) {
  const fontSize = kp.width === '58mm' ? '10px' : '12px';
  const paperWidth = kp.width === '58mm' ? '48mm' : '72mm';
  const separator = kp.width === '58mm' ? '-'.repeat(32) : '-'.repeat(42);

  const dateStr = new Date(data.date).toLocaleString('id-ID');

  let lines: string[] = [];

  // Header
  lines.push(center(`TIKET DAPUR - #${data.queueNumber}`, kp.width));
  lines.push(center(kp.name.toUpperCase(), kp.width));
  if (data.isReprint) {
    lines.push(center('*** CETAK ULANG ***', kp.width));
  }
  lines.push(separator);

  // Info
  lines.push(`Tgl: ${dateStr}`);
  lines.push(`Kasir: ${data.cashierName}`);
  if (data.customerName) lines.push(`Pelanggan: ${data.customerName}`);
  if (data.orderType) lines.push(`Tipe: ${data.orderType}${data.tableNumber ? ` (${data.tableNumber})` : ''}`);
  lines.push(separator);

  // Items
  for (const item of items) {
    const addonStr = item.addons.length > 0 ? ` +${item.addons.map(a => a.name).join(',')}` : '';
    lines.push(`${item.name}`);
    const sugarStr = item.showSugarLevel !== false ? `/${item.sugar}` : '';
    const tempStr = item.showTemperature !== false ? item.temperature : '';
    const detailStr = `${tempStr}${sugarStr}${addonStr}`.trim();
    if (detailStr) {
      lines.push(`  ${detailStr}`);
    }
    lines.push(`  QTY: ${item.quantity}`);
    lines.push('');
  }

  lines.push(separator);
  lines.push('');
  lines.push(center('Selesai Tiket', kp.width));
  lines.push('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Tiket Dapur #${data.queueNumber} - ${kp.name}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; font-size: ${fontSize}; width: ${paperWidth}; margin: 0 auto; padding: 4mm 2mm; color: #000; }
        pre { white-space: pre-wrap; word-break: break-all; line-height: 1.4; font-weight: bold; font-family: inherit; }
        @media print {
          @page { margin: 0; size: ${kp.width} auto; }
          body { width: 100%; padding: 2mm; }
        }
      </style>
    </head>
    <body>
      <pre>${lines.join('\n')}</pre>
    </body>
    </html>
  `;
  printHtmlInIframe(html);
}

// ============================================================
// KITCHEN TICKET — Bluetooth ESC/POS
// ============================================================

async function buildKitchenESCPOS(data: ReceiptData, items: CartItem[], kp: KitchenPrinterConfig): Promise<Uint8Array> {
  const maxChars = kp.width === '58mm' ? 32 : 42;
  const encoder = new TextEncoder();
  const ESC = 0x1B;
  const GS = 0x1D;
  const commands: number[] = [];

  // Reset printer & center align
  commands.push(ESC, 0x40);
  commands.push(ESC, 0x61, 0x01);

  // 1. Header (Scoped bold and explicit CRLF line feeds to prevent buffer overlap)
  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode(`TIKET DAPUR - #${data.queueNumber}\r\n`));
  commands.push(ESC, 0x45, 0x00);

  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode(`${kp.name.toUpperCase()}\r\n`));
  commands.push(ESC, 0x45, 0x00);

  if (data.isReprint) {
    commands.push(ESC, 0x45, 0x01);
    commands.push(...encoder.encode('*** CETAK ULANG ***\r\n'));
    commands.push(ESC, 0x45, 0x00);
  }

  // Left align for body
  commands.push(ESC, 0x61, 0x00);
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\r\n'));
  commands.push(...encoder.encode(`Tgl: ${new Date(data.date).toLocaleString('id-ID')}\r\n`));
  commands.push(...encoder.encode(`Kasir: ${data.cashierName}\r\n`));
  if (data.customerName) {
    commands.push(...encoder.encode(`Pelanggan: ${data.customerName}\r\n`));
  }
  if (data.orderType) {
    commands.push(...encoder.encode(`Tipe: ${data.orderType}${data.tableNumber ? ` (${data.tableNumber})` : ''}\r\n`));
  }
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\r\n'));

  // Items list
  for (const item of items) {
    commands.push(...encoder.encode(`${item.name}\r\n`));
    const addonStr = item.addons.length > 0 ? ` +${item.addons.map(a => a.name).join(',')}` : '';
    const sugarStr = item.showSugarLevel !== false ? `/${item.sugar}` : '';
    const tempStr = item.showTemperature !== false ? item.temperature : '';
    const detailStr = `${tempStr}${sugarStr}${addonStr}`.trim();
    if (detailStr) {
      commands.push(...encoder.encode(`  ${detailStr}\r\n`));
    }
    commands.push(ESC, 0x45, 0x01);
    commands.push(...encoder.encode(`  QTY: ${item.quantity}\r\n\r\n`));
    commands.push(ESC, 0x45, 0x00);
  }

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\r\n'));
  commands.push(ESC, 0x61, 0x01);
  commands.push(...encoder.encode('\r\nSelesai Tiket\r\n\r\n'));
  commands.push(ESC, 0x64, 0x04);
  commands.push(GS, 0x56, 0x00);

  return new Uint8Array(commands);
}

async function printKitchenReceiptBluetooth(data: ReceiptData, items: CartItem[], kp: KitchenPrinterConfig): Promise<void> {
  if (!isBluetoothConnected(kp.id)) {
    throw new Error(`Printer Bluetooth "${kp.name}" belum terhubung. Sambungkan printer terlebih dahulu di Settings.`);
  }

  const escposData = await buildKitchenESCPOS(data, items, kp);
  await sendToBluetoothPrinter(kp.id, escposData);
}

// ============================================================
// MAIN PRINT ORCHESTRATOR — Error Isolation with Promise.allSettled
// ============================================================

export async function printReceipt(
  data: ReceiptData,
  settings: AppSettings,
  targetPrinter: 'all' | 'cashier' = 'all',
  preOpenedWindow?: Window | null
): Promise<PrintJobResult[]> {
  const results: PrintJobResult[] = [];

  // 1. Print cashier receipt
  if (settings.printerEnabled) {
    try {
      if (settings.printerType === 'bluetooth') {
        await printReceiptBluetooth(data, settings.printerWidth);
      } else {
        printReceiptBrowser(data, settings.printerWidth, preOpenedWindow);
      }
      results.push({ printer: 'Printer Kasir', status: 'success' });
    } catch (err: any) {
      console.error('[PrintReceipt] Cashier print failed:', err);
      results.push({ printer: 'Printer Kasir', status: 'error', error: err.message });
    }
  }

  // 2. Print kitchen tickets (only when target is 'all')
  if (targetPrinter === 'all' && settings.kitchenPrinters && settings.kitchenPrinters.length > 0) {
    const kitchenJobs = settings.kitchenPrinters
      .filter(kp => kp.enabled)
      .map(async (kp): Promise<PrintJobResult> => {
        // Filter items by kitchen target (Bundles themselves are NEVER printed in kitchen, only child items)
        const matchingItems = data.items.filter((item) => {
          if (item.isBundle) return false;
          const itemTarget = (item.kitchenTarget || '').trim().toLowerCase();
          const printerTarget = (kp.targetCategory || '').trim().toLowerCase();
          return itemTarget === printerTarget && printerTarget !== '';
        });

        if (matchingItems.length === 0) {
          return { printer: kp.name, status: 'success' }; // Nothing to print = success
        }

        try {
          if (kp.type === 'bluetooth') {
            await printKitchenReceiptBluetooth(data, matchingItems, kp);
          } else {
            printKitchenReceiptBrowser(data, matchingItems, kp);
          }
          return { printer: kp.name, status: 'success' };
        } catch (err: any) {
          console.error(`[PrintReceipt] Kitchen print failed for ${kp.name}:`, err);
          return { printer: kp.name, status: 'error', error: err.message };
        }
      });

    const kitchenResults = await Promise.allSettled(kitchenJobs);
    for (const result of kitchenResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({ printer: 'Kitchen (unknown)', status: 'error', error: result.reason?.message });
      }
    }
  }

  return results;
}

// ============================================================
// TEST PRINT — Independent per printer
// ============================================================

export async function testPrintBluetooth(
  printerId: string,
  printerName: string,
  targetLabel: string,
  width: '58mm' | '80mm' = '58mm'
): Promise<void> {
  if (!isBluetoothConnected(printerId)) {
    throw new Error(`Printer "${printerName}" belum terhubung.`);
  }

  const conn = printerRegistry.get(printerId);
  const deviceName = conn?.deviceName || 'Unknown';

  const maxChars = width === '58mm' ? 32 : 42;
  const encoder = new TextEncoder();
  const ESC = 0x1B;
  const GS = 0x1D;
  const commands: number[] = [];

  commands.push(ESC, 0x40); // Initialize
  commands.push(ESC, 0x61, 0x01); // Center

  commands.push(ESC, 0x45, 0x01); // Bold on
  commands.push(...encoder.encode('BERDIKARIPOS\n'));
  commands.push(...encoder.encode('TEST PRINT\n'));
  commands.push(ESC, 0x45, 0x00); // Bold off

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));
  commands.push(ESC, 0x61, 0x00); // Left align
  commands.push(...encoder.encode(`Printer: ${printerName}\n`));
  commands.push(...encoder.encode(`Target: ${targetLabel}\n`));
  commands.push(...encoder.encode(`Device: ${deviceName}\n`));
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  commands.push(ESC, 0x61, 0x01); // Center
  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode('\nStatus: OK\n\n'));
  commands.push(ESC, 0x45, 0x00);

  commands.push(ESC, 0x64, 0x04); // Feed
  commands.push(GS, 0x56, 0x00); // Cut

  const data = new Uint8Array(commands);
  await sendToBluetoothPrinter(printerId, data);
}

// ============================================================
// RAW TEXT PRINTING (for shift summary etc.)
// ============================================================

export async function printTextRaw(lines: string[], settings: AppSettings) {
  if (!settings.printerEnabled) {
    fallbackBrowserPrintText(lines, '58mm');
    return;
  }

  if (settings.printerType === 'bluetooth') {
    // Ensure cashier printer is connected
    if (!isBluetoothConnected(CASHIER_PRINTER_ID)) {
      const result = await connectBluetoothPrinter(CASHIER_PRINTER_ID);
      if (!result.success) {
        fallbackBrowserPrintText(lines, settings.printerWidth);
        return;
      }
    }

    const maxChars = settings.printerWidth === '58mm' ? 32 : 42;
    const encoder = new TextEncoder();
    const ESC = 0x1B;
    const GS = 0x1D;
    const commands: number[] = [];

    commands.push(ESC, 0x40);
    commands.push(ESC, 0x61, 0x00);

    for (const line of lines) {
      commands.push(...encoder.encode(line + '\n'));
    }

    commands.push(ESC, 0x64, 0x04);
    commands.push(GS, 0x56, 0x00);

    const data = new Uint8Array(commands);
    try {
      await sendToBluetoothPrinter(CASHIER_PRINTER_ID, data);
    } catch (err) {
      console.error('printTextRaw Bluetooth error:', err);
      fallbackBrowserPrintText(lines, settings.printerWidth);
    }
  } else {
    fallbackBrowserPrintText(lines, settings.printerWidth);
  }
}

export function printHtmlInIframe(htmlContent: string) {
  let iframe = document.getElementById('thermal-print-iframe') as HTMLIFrameElement;
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'thermal-print-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = '0px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);
  }

  const doc = iframe.contentWindow?.document || iframe.contentDocument;
  if (doc) {
    doc.open();
    doc.write(htmlContent);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.error('Iframe print error:', e);
      }
    }, 250);
  } else {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
        setTimeout(() => printWindow.close(), 1000);
      }, 300);
    }
  }
}

function fallbackBrowserPrintText(lines: string[], width: '58mm' | '80mm') {
  const fontSize = width === '58mm' ? '10px' : '12px';
  const paperWidth = width === '58mm' ? '48mm' : '72mm';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Ringkasan</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; font-size: ${fontSize}; width: ${paperWidth}; margin: 0 auto; padding: 4mm 2mm; color: #000; }
        pre { white-space: pre-wrap; word-break: break-all; line-height: 1.4; font-family: inherit; }
        @media print {
          @page { margin: 0; size: ${width} auto; }
          body { width: 100%; padding: 2mm; }
        }
      </style>
    </head>
    <body>
      <pre>${lines.join('\n')}</pre>
    </body>
    </html>
  `;
  printHtmlInIframe(html);
}

// ============================================================
// HELPERS
// ============================================================

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${mins}`;
}

export function wrapCenterLines(text: string, width: '58mm' | '80mm'): string[] {
  const maxChars = width === '58mm' ? 32 : 42;
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + (currentLine ? ' ' : '') + word).length <= maxChars) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(center(currentLine, width));
      currentLine = word;
    }
  }
  if (currentLine) lines.push(center(currentLine, width));
  return lines;
}

function center(text: string, width: '58mm' | '80mm'): string {
  const maxChars = width === '58mm' ? 32 : 42;
  const pad = Math.max(0, Math.floor((maxChars - text.length) / 2));
  return ' '.repeat(pad) + text;
}

function leftRight(left: string, right: string, width: '58mm' | '80mm'): string {
  const maxChars = width === '58mm' ? 32 : 42;
  const space = Math.max(1, maxChars - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

function padLeft(text: string, width: '58mm' | '80mm'): string {
  const maxChars = width === '58mm' ? 32 : 42;
  const pad = Math.max(1, maxChars - text.length - 10);
  return ' '.repeat(pad) + text;
}

export function getOrderTypeHeaderLines(orderType?: string, tableNumber?: string): { line1: string; line2?: string } {
  const type = (orderType || 'Dine In').trim();

  if (type.toLowerCase() === 'dine in') {
    let tableStr = '';
    if (tableNumber) {
      const cleanTable = tableNumber.replace(/^meja\s*/i, '').trim();
      tableStr = `MEJA ${cleanTable}`;
    }
    return {
      line1: 'DINE IN',
      line2: tableStr || undefined,
    };
  }

  if (type.toLowerCase() === 'take away' || type.toLowerCase() === 'takeaway') {
    return {
      line1: 'TAKE',
      line2: 'AWAY',
    };
  }

  return {
    line1: type.toUpperCase(),
    line2: tableNumber ? `MEJA ${tableNumber.replace(/^meja\s*/i, '').toUpperCase()}` : undefined,
  };
}
