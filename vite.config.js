import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // GitHub Pages serves project sites below the repository name.
  base: '/cv-builder/',
});
