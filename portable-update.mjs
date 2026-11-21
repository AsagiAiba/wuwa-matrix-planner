import path from 'node:path';
import { newerPackageVersion } from './portable-version.js';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, copyFile, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const run = promisify(execFile);
const maxZip = 512 * 1024 * 1024;
const maxBackup = 32 * 1024 * 1024;

async function* bounded(input, maximum) {
  let size = 0;
  for await (const chunk of input) {
    size += chunk.length;
    if (size > maximum) throw Error('文件超过允许大小。');
    yield chunk;
  }
}

export function createUpdateHandler(root, version, port) {
  let pending = null;
  let busy = false;
  let expiry;
  const origin = 'http://127.0.0.1:' + port;

  async function discard() {
    clearTimeout(expiry);
    if (pending) await rm(pending.work, { recursive: true, force: true });
    pending = null;
  }

  function expireLater() {
    clearTimeout(expiry);
    expiry = setTimeout(() => {
      if (busy) { expireLater(); return; }
      busy = true;
      discard().catch(console.error).finally(() => { busy = false; });
    }, 15 * 60_000);
    expiry.unref();
  }

  return async function handle(req, res, route) {
    const reply = (code, value) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    if (req.headers.host !== '127.0.0.1:' + port || req.headers['x-matrix-update'] !== '1') return reply(403, {});
    if (route === '/__update/info' && req.method === 'GET') return reply(200, { version });
    if (req.method !== 'POST' || req.headers.origin !== origin) return reply(403, {});
    if (busy) return reply(409, { error: '另一个更新操作正在进行。' });
    busy = true;
    let applying = false;
    try {
      if (route === '/__update/prepare') {
        const expected = newerPackageVersion(req.headers['x-package-name'], version);
        if (pending) throw Error('已有待确认的更新，请先取消或稍后重试。');
        if (req.headers['content-type'] !== 'application/zip' || Number(req.headers['content-length']) > maxZip) throw Error('请选择小于 512 MB 的便携 ZIP。');
        const work = await mkdtemp(path.join(path.dirname(root), '.matrix-update-'));
        pending = { work, id: randomUUID() };
        try {
          await writeFile(path.join(work,'install-root.txt'),root,{flag:'wx'});
          const zip = path.join(work, 'package.zip');
          await pipeline(Readable.from(bounded(req, maxZip)), createWriteStream(zip, { flags: 'wx' }));
          const result = await run(path.join(root, 'MatrixUpdate.exe'), ['prepare', work, root, version], { windowsHide: true, timeout: 180_000 });
          pending.version = result.stdout.trim();
          if (pending.version !== expected) throw Error('文件名版本与包内版本不一致，请重新下载便携包。');
          await unlink(zip);
          expireLater();
          reply(200, { version: pending.version, id: pending.id });
        } catch (error) {
          await discard();
          throw error;
        }
      } else {
        if (!pending || req.headers['x-update-id'] !== pending.id) throw Error('更新已失效，请重新选择包体。');
        if (route === '/__update/cancel') {
          await discard();
          return reply(200, {});
        }
        if (route !== '/__update/apply') return reply(404, {});
        const chunks = [];
        for await (const chunk of bounded(req, maxBackup)) chunks.push(chunk);
        const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!backup || Array.isArray(backup) || typeof backup !== 'object' || !Object.entries(backup).every(([k,v]) => /^(wuwa-|afyg-)/.test(k) && typeof v === 'string')) throw Error('方案备份格式错误。');
        const { work } = pending;
        await writeFile(path.join(work, '排布备份.json'), JSON.stringify({ version, port, localStorage: backup }), 'utf8');
        const helper = path.join(work, 'MatrixUpdate.exe');
        await copyFile(path.join(root, 'MatrixUpdate.exe'), helper);
        const ready = path.join(work, 'ready');
        await rm(ready, { force: true });
        const proc = spawn(helper, ['apply', work, root, pending.version, String(port), String(process.pid), process.env.MATRIX_LAUNCHER_PID, process.env.MATRIX_HEADLESS || '0'], {
          cwd: work, windowsHide: true, detached: true, stdio: 'ignore'
        });
        await once(proc, 'spawn');
        let acknowledged = false;
        for (let i = 0; i < 100 && proc.exitCode === null; i++) {
          try { await access(ready); acknowledged = true; break; } catch {}
          await delay(100);
        }
        if (!acknowledged) {
          if (proc.exitCode === null) proc.kill();
          throw Error('更新助手启动失败，当前版本仍可使用。');
        }
        proc.unref();
        clearTimeout(expiry);
        applying = true;
        res.once('close', () => process.exit(0));
        reply(200, { work });
      }
    } catch (error) {
      reply(400, { error: error.stderr?.trim() || error.message });
    } finally {
      if (!applying) busy = false;
    }
  };
}
