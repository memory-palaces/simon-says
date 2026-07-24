import { defineConfig, type Plugin } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * A tiny dev-server API so the app can save/open palace files directly on THIS
 * machine (no download dialog, works in every browser) instead of only via the
 * File System Access API. Files live in a `saved/` folder next to the project —
 * everything stays local; nothing is uploaded anywhere.
 *
 * Routes (all under /api, intercepted before Vite's SPA fallback):
 *   GET    /api/ping              -> { palaceServer: true }   (feature detection)
 *   GET    /api/palaces           -> { items: [{name,size,mtime}] }
 *   GET    /api/palaces/:name     -> the palace JSON
 *   PUT    /api/palaces/:name     -> write the palace JSON (body)
 *   DELETE /api/palaces/:name     -> remove it
 */
function palaceServer(): Plugin {
  const dir = path.resolve(process.cwd(), 'saved');
  const safe = (n: string): string =>
    path.basename(String(n)).replace(/\.json$/i, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'palace';

  return {
    name: 'palace-server',
    configureServer(server) {
      const sendJson = (res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (s: string) => void }, code: number, body: unknown): void => {
        res.statusCode = code;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      };
      const readBody = (req: NodeJS.ReadableStream): Promise<string> =>
        new Promise((resolve, reject) => {
          let data = '';
          req.on('data', (c) => (data += c));
          req.on('end', () => resolve(data));
          req.on('error', reject);
        });

      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (!url.startsWith('/api/')) return next();
        try {
          if (url === '/api/ping') return sendJson(res, 200, { palaceServer: true, dir });

          if (url === '/api/palaces') {
            await fs.mkdir(dir, { recursive: true });
            if (req.method === 'GET') {
              const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
              const items = await Promise.all(
                files.map(async (f) => {
                  const st = await fs.stat(path.join(dir, f));
                  return { name: f.replace(/\.json$/, ''), size: st.size, mtime: st.mtimeMs };
                }),
              );
              return sendJson(res, 200, { items });
            }
          }

          const m = url.match(/^\/api\/palaces\/(.+)$/);
          if (m) {
            await fs.mkdir(dir, { recursive: true });
            const file = path.join(dir, safe(decodeURIComponent(m[1])) + '.json');
            if (req.method === 'GET') {
              const data = await fs.readFile(file, 'utf8');
              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              return res.end(data);
            }
            if (req.method === 'PUT') {
              const body = await readBody(req);
              JSON.parse(body); // reject malformed payloads before touching disk
              await fs.writeFile(file, body, 'utf8');
              return sendJson(res, 200, { ok: true });
            }
            if (req.method === 'DELETE') {
              await fs.unlink(file).catch(() => undefined);
              return sendJson(res, 200, { ok: true });
            }
          }
          return sendJson(res, 404, { error: 'not found' });
        } catch (err) {
          return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}

// base: './' makes every asset path relative, so a production build can be served
// from any subdirectory or a bare static file server — no absolute-path assumptions.
// This is what keeps the spec's "runs from a trivial static server" promise true.
export default defineConfig({
  base: './',
  plugins: [palaceServer()],
  server: {
    host: true, // listen on 0.0.0.0 so the Docker path works without extra flags
    port: 5173,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
