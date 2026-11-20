import http from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const port = Number(process.env.MATRIX_PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const allowed = new Set(['index.html', 'app.js', 'styles.css', 'score-axis.js', 'plan-library.js', 'season-config.js','afyg-preset.js','cingulum.js','roster-recognition.js','afyg-replay/site/execution-position.js']);
const replayRoot = path.join(root, 'afyg-replay', 'site');
const replayPages = new Map(['replay.html','replay.js','replay.css','execution-position.js','sample.json'].map(name=>['/'+name,name]));
replayPages.set('/fast-calc','fast-calc.html');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    // The local engine uses root-relative asset and character-info URLs.
    const replayName = replayPages.get(pathname) ?? (/^\/(?:_app\/immutable\/|api\/v[13]\/|fonts\/|icons\/)/.test(pathname) ? pathname.slice(1) : null);
    if (replayName !== null) {
      if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const file = path.resolve(replayRoot,replayName);
      if (replayName.includes('..') || replayName.includes('\\') || !file.startsWith(replayRoot+path.sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
      const type = pathname.startsWith('/api/') ? mime['.json'] : mime[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, {'Content-Type':type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      if(request.method==='HEAD') response.end(); else createReadStream(file).on('error',()=>response.destroy()).pipe(response);
      return;
    }
    if (pathname === '/__matrix_health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ app: 'wuwa-matrix-hp-planner', version, root, pid: process.pid })); return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    const inside = file.startsWith(root + path.sep);
    // Match the filesystem path, including Windows separators and case folding.
    const resolvedRelative = path.relative(root, file).split(path.sep).join('/');
    const privatePath = process.platform === 'win32' ? resolvedRelative.toLowerCase() : resolvedRelative;
    const rawFile = privatePath === 'data/raw' || privatePath.startsWith('data/raw/');
    const publicFile = allowed.has(relative) || ['assets/', 'data/', 'config/'].some(prefix => relative.startsWith(prefix));
    if (!inside || !publicFile || relative.includes('..') || rawFile) {
      response.writeHead(404).end('Not found'); return;
    }
    const info = await stat(file);
    if (!info.isFile()) { response.writeHead(404).end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end('Not found'); }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已占用，请打开 http://127.0.0.1:${port}` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`血线排布 Demo：http://127.0.0.1:${port}\n保持此窗口打开；按 Ctrl+C 停止。`));
