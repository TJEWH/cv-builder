import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import responsivePdfRenderer from './build/responsivePdfRenderer.js';

export default defineConfig({
  plugins: [responsivePdfRenderer(), vue()],
  // Keep the renderer's source visible to the scheduling adapter in dev too.
  optimizeDeps: { exclude: ['html2pdf.js'] },
  // GitHub Pages serves project sites below the repository name.
  base: '/cv-builder/',
});
