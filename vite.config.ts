import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
      },
      includeAssets: ['sounds/kds-alarm.wav'],
      manifest: {
        name: 'BerdikariPOS',
        short_name: 'BerdikariPOS',
        description: 'Point of Sale System untuk berbagai jenis usaha',
        theme_color: '#b85f21',
        background_color: '#fdf8f3',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: '/icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
          },
          {
            src: '/icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wav}'],
        // v4.7 TO DO 13.9 (O-9): SPA — semua navigasi (termasuk route client) jatuh ke
        // index.html yang di-precache → app shell tetap terbuka offline (banner offline
        // O-4/O-6 tampil di dalamnya). Plugin tidak mendukung `offlineFallback` di versi
        // ini, jadi index.html yang di-precache BERFUNGSI sebagai halaman fallback offline.
        navigateFallback: 'index.html',
        navigateFallbackAllowlist: [/^\/.*$/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          // v4.7 TO DO 13.9 (O-9): aset same-origin yang tidak di-precache (mis. chunk
          // baru setelah update) — NetworkFirst (network dulu, fallback cache 5 detik).
          // Supabase API (origin berbeda) TIDAK dicache — tulis/read tetap lewat jaringan.
          {
            urlPattern: ({ url }) => url.origin === self.location.origin,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'same-origin-assets',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['.ngrok-free.dev', '.ngrok.io'],
  },
});
