import { defineConfig } from 'vite'

// Standalone "coming soon" page for orchestraty.com.
//
// Serves coming.html at the dev-server root so http://localhost:5373/ loads
// the teaser. The page is fully self-contained (inline CSS + JS, no React,
// no backend), so it also deploys as a single static file / dist-coming.

const serveComingAtRoot = {
  name: 'coming-root',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
    server.middlewares.use((req, _res, next) => {
      const url = (req.url || '/').split('?')[0]
      const internal = url.startsWith('/@') || url.startsWith('/src/') || url.startsWith('/node_modules/')
      const seg = url.slice(url.lastIndexOf('/') + 1)
      if (url === '/index.html' || (!internal && !seg.includes('.'))) {
        req.url = '/coming.html'
      }
      next()
    })
  },
}

export default defineConfig({
  plugins: [serveComingAtRoot],
  server: {
    port: 5373,
    strictPort: true,
    host: true,
  },
  build: {
    outDir: 'dist-coming',
    rollupOptions: {
      input: 'coming.html',
    },
  },
})
