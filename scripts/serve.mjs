import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('.');
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json'};
createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(root + '/') || path.includes('/node_modules/')) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(path); res.writeHead(200, {'Content-Type':types[extname(path)] || 'application/octet-stream'}); res.end(body); }
  catch { res.writeHead(404); res.end('Archivo no encontrado'); }
}).listen(4175, '127.0.0.1', () => console.log('Sulmi: http://localhost:4175'));
