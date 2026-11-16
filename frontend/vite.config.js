import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    cors: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        // Explicit IPv4: on macOS `localhost` can resolve to ::1 while Spring
        // Boot listens on 0.0.0.0, which makes every proxied request fail with
        // an opaque 500 from the dev server.
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false
      }
    }
  }
});
