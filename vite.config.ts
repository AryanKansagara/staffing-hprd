import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Serves the /api/cms function locally in dev and preview, the same code Vercel runs.
function cmsApi(): Plugin {
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/cms')) return next()
    const { GET } = await import('./api/cms.ts')
    const r = await GET(new Request('http://localhost' + req.url))
    res.statusCode = r.status
    r.headers.forEach((v, k) => res.setHeader(k, v))
    res.end(await r.text())
  }
  return { name: 'cms-api', configureServer: s => { s.middlewares.use(handle) }, configurePreviewServer: s => { s.middlewares.use(handle) } }
}

export default defineConfig({ plugins: [react(), cmsApi()] })
