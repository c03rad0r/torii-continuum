import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  // Relative base so assets resolve regardless of where the site is mounted
  // (pplx.app proxy prefix, subdirectory hosting, or root).
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5180,
    host: '127.0.0.1',
  },
  preview: {
    port: 5181,
    host: '127.0.0.1',
  },
});
