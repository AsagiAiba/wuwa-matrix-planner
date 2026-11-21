import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

const [install, target, original] = process.argv.slice(2).map(p => path.resolve(p));
const fromVersion = JSON.parse(await readFile(path.join(install, 'package.json'), 'utf8')).version;
function zipVersion(zip) {
  return /^WuwaMatrixPlanner-v([\d.]+)-win-x64\.zip$/.exec(path.basename(zip))[1];
}
const toVersion = zipVersion(target);
const work = await mkdtemp(path.resolve('build/update-test-'));
const root = path.join(work, '便携软件');
await cp(install, root, { recursive: true });
const reservation = net.createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const url = 'http://127.0.0.1:' + port;
const launcher = spawn(path.join(root, '终焉矩阵血线排布.exe'), ['--headless', '--port', String(port)], { cwd: work, windowsHide: true });
const runtime = process.env.MATRIX_PLAYWRIGHT || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(runtime).href);
let browser;
let serverPid;
try {
  for (let i = 0; i < 100; i++) {
    await pause(150);
    try {
      const health = await (await fetch(url + '/__matrix_health')).json();
      if (health.root === root) { serverPid = health.pid; break; }
    } catch {}
  }
  assert.ok(serverPid, 'packaged v' + fromVersion + ' did not start at ' + url);
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  await page.goto(url);
  await page.locator('#duplicate-plan').click();
  const savedName = '拖包测试 · 保留我的队伍';
  await page.locator('#plan-name').fill(savedName);
  await page.locator('#confirm-plan').click();
  const savedId = await page.locator('#plan-select').inputValue();
  const savedConfig = () => page.evaluate(id => JSON.parse(localStorage.getItem('wuwa-matrix-plan-library-v1')).plans.find(p => p.id === id)?.config, savedId);
  const before = await savedConfig();
  await page.getByRole('button', {name:'软件更新',exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'更新便携版'});
  const picker = dialog.locator('input[type=file]');
  const status = dialog.getByRole('status');
  await picker.setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('invalid') });
  await page.waitForFunction(() => document.querySelector('[data-pick]').disabled === false && !document.querySelector('[data-apply]').offsetWidth);
  assert.doesNotMatch(await status.innerText(), /正在解压|当前版本/);
  await picker.setInputFiles(install + '.zip');
  await status.filter({hasText:/更新的版本|无需重复更新/}).waitFor();
  await picker.setInputFiles(original);
  await dialog.getByRole('button', {name:'更新并重启'}).waitFor();
  assert.ok((await status.innerText()).includes('v' + fromVersion + ' → v' + zipVersion(original)));
  await dialog.getByRole('button', {name:'取消'}).click();
  await dialog.waitFor({state:'hidden'});
  assert.equal((await (await fetch(url+'/__matrix_health')).json()).pid, serverPid);
  // Simulate a new service failing to start, only in the disposable test copy.
  await page.getByRole('button', {name:'软件更新',exact:true}).click();
  await picker.setInputFiles(target);
  await dialog.getByRole('button', {name:'更新并重启'}).waitFor();
  const [failedUpdate] = (await readdir(work)).filter(n => n.startsWith('.matrix-update-'));
  await writeFile(path.join(work, failedUpdate, 'next', 'server.mjs'), 'process.exit(1);');
  await dialog.getByRole('button', {name:'更新并重启'}).click();
  await status.filter({hasText:'已恢复 v' + fromVersion}).waitFor({timeout:90000});
  assert.deepEqual(await savedConfig(), before);
  await dialog.getByRole('button', {name:'关闭'}).click();
  serverPid = (await (await fetch(url+'/__matrix_health')).json()).pid;
  // Use a browser File backed by the real ZIP, then exercise the window drop handler.
  await page.evaluate(() => { const f=document.createElement('input'); f.type='file'; f.id='test-os-drop'; f.hidden=true; document.body.append(f); });
  await page.locator('#test-os-drop').setInputFiles(target);
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(document.querySelector('#test-os-drop').files[0]);
    document.dispatchEvent(new DragEvent('drop', {dataTransfer,bubbles:true,cancelable:true}));
  });
  const apply = dialog.getByRole('button', {name:'更新并重启'});
  await apply.waitFor();
  await apply.click();
  await page.waitForFunction(v => document.title.endsWith('V' + v), toVersion, {timeout:90000});
  await page.waitForFunction(id => document.querySelector('#plan-select')?.value === id, savedId);
  const after = await (await fetch(url+'/__matrix_health')).json();
  assert.equal(after.root, root); assert.equal(after.version, toVersion); assert.notEqual(after.pid, serverPid);
  serverPid = after.pid;
  assert.equal(await page.locator('#plan-select option:checked').innerText(), savedName);
  assert.deepEqual(await savedConfig(), before);
  await page.getByRole('button', {name:'软件更新'}).click();
  let uploads = 0;
  page.on('request', req => { if (req.url().endsWith('/__update/prepare')) uploads++; });
  await page.evaluate(name => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['unused'], name));
    document.dispatchEvent(new DragEvent('drop', {dataTransfer,bubbles:true,cancelable:true}));
  }, path.basename(install + '.zip'));
  await status.filter({hasText:'低于当前'}).waitFor();
  await picker.setInputFiles(target);
  await status.filter({hasText:'无需重复更新'}).waitFor();
  assert.equal(uploads, 0, 'old and same-version names must be rejected before upload');
  let leftovers;
  for(let i=0;i<300;i++){
    leftovers=(await readdir(work)).filter(n=>n.startsWith('.matrix-update-') && n!==failedUpdate);
    if(!leftovers.length)break;
    await pause(150);
  }
  assert.deepEqual(leftovers,[],'successful update should be cleaned after restart');
  const backupDir=path.join(work,'排布备份');
  const names=await readdir(backupDir);
  assert.equal(names.length,1);
  const backup=JSON.parse(await readFile(path.join(backupDir,names[0]),'utf8'));
  assert.equal(JSON.parse(backup.localStorage['wuwa-matrix-plan-library-v1']).activePlanId,savedId);
  const failed=await readdir(path.join(work,failedUpdate));
  assert.ok(failed.includes('failed')&&failed.includes('update.log')&&failed.includes('排布备份.json'));
  console.log('PASS: v%s → v%s, cancellation, rollback, restart, plan and team data, backup, filename checks before upload.', fromVersion, toVersion);
} finally {
  if (browser) await browser.close();
  try {
    const health = await (await fetch(url+'/__matrix_health')).json();
    if (health.root === root) process.kill(health.pid);
  } catch {}
  if (launcher.exitCode === null) launcher.kill();
}

