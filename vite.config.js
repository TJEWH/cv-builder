import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // The deployed app is served from the root of its custom GitHub Pages domain.
  base: '/',
});
