import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const assetDirectories = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
const contentTypes: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.icc': 'application/vnd.iccprofile',
  '.txt': 'text/plain; charset=utf-8',
};

/** Keep all PDF.js support files local, including deployments below a base path. */
export default function pdfPreviewAssets(): Plugin {
  const packageDirectory = dirname(require.resolve('pdfjs-dist/package.json'));
  // Only paths enumerated from the package may be served. Never resolve an HTTP
  // path against the filesystem, and never follow symlinks in the asset tree.
  const files = new Map<string, string>();
  function collect(relativeDirectory: string) {
    for (const entry of readdirSync(join(packageDirectory, relativeDirectory), { withFileTypes: true })) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) collect(relativePath);
      else if (entry.isFile()) files.set(relativePath, join(packageDirectory, relativePath));
    }
  }
  for (const directory of assetDirectories) collect(directory);
  let base = '/';

  return {
    name: 'pdf-preview-assets',
    configResolved(config) { base = config.base; },
    configureServer(server) {
      const prefix = `${base.replace(/\/$/, '')}/pdfjs/`;
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0] ?? '';
        if (!path.startsWith(prefix) || !['GET', 'HEAD'].includes(request.method ?? 'GET')) return next();
        let relativePath: string;
        try { relativePath = decodeURIComponent(path.slice(prefix.length)); }
        catch { response.statusCode = 400; response.end(); return; }
        if (relativePath.includes('\\') || relativePath.includes('\0') || relativePath.split('/').some(part => part === '.' || part === '..')) {
          response.statusCode = 400;
          response.end();
          return;
        }
        const file = files.get(relativePath);
        if (!file) { response.statusCode = 404; response.end(); return; }
        const bytes = readFileSync(file);
        response.setHeader('Content-Type', contentTypes[extname(file)] ?? 'application/octet-stream');
        response.setHeader('Content-Length', bytes.length);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(request.method === 'HEAD' ? undefined : bytes);
      });
    },
    generateBundle() {
      for (const [relativePath, file] of files) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/${relativePath}`, source: readFileSync(file) });
      }
    },
  };
}
