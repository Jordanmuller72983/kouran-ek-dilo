import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API server also serves poster thumbnails under /media.
    proxy: { '/api': 'http://localhost:4000', '/media': 'http://localhost:4000' },
  },
});
