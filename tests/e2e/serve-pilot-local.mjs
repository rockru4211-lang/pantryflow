import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve(process.env.PF_E2E_FRONTEND_ROOT || '');
const port = Number(process.env.PF_E2E_FRONTEND_PORT || 4173);
if (!root || !Number.isInteger(port)) throw new Error('LOCAL_FRONTEND_SERVER_CONFIG_REQUIRED');

const mime = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
]);

createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
    const candidate = path.resolve(root, relative);
    if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error('INVALID_PATH');
    const file = (await stat(candidate)).isDirectory() ? path.join(candidate, 'index.html') : candidate;
    response.writeHead(200, {
      'content-type': mime.get(path.extname(file)) || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(port, '127.0.0.1');
