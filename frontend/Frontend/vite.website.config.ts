import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Phase B — marketing-website Vite config.
//
// Serves website.html at the dev-server root so http://localhost:5273/ loads
// the marketing landing instead of index.html (which is the dashboard app).
// Mirrors the pattern already used by vite.superadmin.config.ts.

const serveWebsiteAtRoot = {
  name: 'website-root',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
    server.middlewares.use((req, _res, next) => {
      const url = (req.url || '/').split('?')[0]
      const internal = url.startsWith('/@') || url.startsWith('/src/') || url.startsWith('/node_modules/')
      const seg = url.slice(url.lastIndexOf('/') + 1)
      // Serve the website SPA shell for any client route (/, /docs, /docs/x, /tour, /pricing),
      // but leave Vite internals and real asset files (those with an extension) alone.
      if (url === '/index.html' || (!internal && !seg.includes('.'))) {
        req.url = '/website.html'
      }
      next()
    })
  },
}

export default defineConfig({
  plugins: [react(), serveWebsiteAtRoot],
  server: {
    port: 5273,
    strictPort: true,
    host: true,
    // The marketing site does not call the API today, but a proxy is kept
    // so optional "demo" endpoints (Phase F) can be wired in without a
    // CORS shuffle.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist-website',
    rollupOptions: {
      input: 'website.html',
    },
  },
})
