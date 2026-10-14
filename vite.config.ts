import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
const base = process.env.URBANACCESS_BASE ?? '/UrbanAccess-Accessibility-Audit-Routing/frontend/';
if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('URBANACCESS_BASE must start and end with /');
export default defineConfig({
  root: 'frontend', base,
  define: { __APP_VERSION__: JSON.stringify(process.env.URBANACCESS_BUILD_ID ?? 'm1-z2-backup') },
  plugins: [react(), tailwindcss(), VitePWA({
    strategies: 'injectManifest', srcDir: 'src/pwa', filename: 'sw.ts',
    registerType: 'prompt', injectRegister: false,
    manifest: { name: 'UrbanAccess', short_name: 'UrbanAccess', lang: 'ru',
      description: 'Обследования доступности объектов', start_url: base, scope: base,
      display: 'standalone', background_color: '#f2f4f0', theme_color: '#12372a',
      icons: [{ src: `${base}icons/icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] },
    injectManifest: { globPatterns: ['**/*.{html,js,css,svg,png,woff,woff2,json}'], maximumFileSizeToCacheInBytes: 10 * 1024 * 1024 },
  })],
  build: { outDir: '../dist/frontend', emptyOutDir: true,
    rollupOptions: { input: { main: resolve('frontend/index.html'),
      ...(process.env.URBANACCESS_VOICE_TEST_BUILD === '1' ? { voice: resolve('frontend/tests/voice.html') } : {}),
      ...(process.env.URBANACCESS_MEDIA_TEST_BUILD === '1' ? { media: resolve('frontend/tests/media.html') } : {}),
      ...(process.env.URBANACCESS_TEST_BUILD === '1' ? { qa: resolve('frontend/tests/phase0.html') } : {}) } } },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
