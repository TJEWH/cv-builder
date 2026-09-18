import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import responsivePdfRenderer from './build/responsivePdfRenderer.ts';
import vectorFontDecompression from './build/vectorFontDecompression.ts';

export default defineConfig({
  plugins: [responsivePdfRenderer(), vectorFontDecompression(), vue()],
  // GitHub Pages serves project sites below the repository name.
  base: '/cv-builder/',
});
