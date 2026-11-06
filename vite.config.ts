import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`        -> web/PWA build in dist/ (also used by the Tauri desktop app)
// `npm run build:single` -> one self-contained index.html (for quick previews)
export default defineConfig(({ mode }) => ({
  base: './',
  clearScreen: false,
  resolve: mode === 'single' ? { alias: { 'virtual:pwa-register': '/src/stubs/pwa-register.ts' } } : {},
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', outDir: mode === 'single' ? 'dist-single' : 'dist', chunkSizeWarningLimit: 2000 },
  plugins: [
    react(),
    mode === 'single'
      ? viteSingleFile()
      : VitePWA({
          registerType: 'autoUpdate',
          injectRegister: false,
          includeAssets: ['icon.svg', 'apple-touch-icon.png', 'icon-512.png'],
          manifest: {
            name: 'Writell', short_name: 'Writell', description: 'A writing environment for novelists',
            theme_color: '#16171b', background_color: '#16171b', display: 'standalone', start_url: './',
            icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
          },
          workbox: { globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'], maximumFileSizeToCacheInBytes: 5_000_000 },
        }),
  ],
}));
