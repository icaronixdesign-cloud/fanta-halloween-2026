import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Mídia em public/media/fanta é servida como arquivo estático (com suporte a Range),
// sem passar pelo bundler. Os MP4 originais nunca são transformados no build.
export default defineConfig({
  plugins: [react()],
  server: { port: 5190, strictPort: true },
  preview: { port: 4180, strictPort: false },
  build: { assetsInlineLimit: 0, target: 'es2022' },
});
