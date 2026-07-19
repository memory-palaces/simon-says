import { defineConfig } from 'vite';

// base: './' makes every asset path relative, so a production build can be served
// from any subdirectory or a bare static file server — no absolute-path assumptions.
// This is what keeps the spec's "runs from a trivial static server" promise true.
export default defineConfig({
  base: './',
  server: {
    host: true, // listen on 0.0.0.0 so the Docker path works without extra flags
    port: 5173,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
