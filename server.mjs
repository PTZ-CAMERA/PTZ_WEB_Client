import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname);
// 파일만 assets/로 정리한다. 기존 배포에서 쓰던 루트 asset URL은 계속 제공한다.
const assetAliases = new Map([
  ['/app.js', 'assets/js/app.js'],
  ['/native-webrtc.js', 'assets/js/native-webrtc.js'],
  ['/vms-workspace.js', 'assets/js/vms-workspace.js'],
  ['/style.css', 'assets/css/style.css'],
]);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 5173);
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, assetAliases.get(pathname) || '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !['.html', '.css', '.js', '.svg'].includes(extname(file))) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '0.0.0.0', () => console.log(`PTZ Web Client: http://localhost:${port}`));
