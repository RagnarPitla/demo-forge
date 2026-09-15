import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One file out. The demo is shared as a URL and sometimes as a folder on a USB
// stick, and a single index.html survives both. It also makes the Azure Static
// Web Apps deploy trivial: there is nothing to resolve at runtime.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 8000,
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
});
