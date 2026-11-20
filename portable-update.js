import { newerPackageVersion } from './portable-version.js';

async function init() {
  const headers = { 'X-Matrix-Update': '1' };
  const info = await fetch('/__update/info', { headers });
  if (!info.ok) return;
  const { version } = await info.json();
  if (!version) return;
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.className = 'quiet';
  entry.textContent = '软件更新';
  document.querySelector('.header-actions').prepend(entry);
  const dialog = document.createElement('dialog');
  dialog.className = 'plan-dialog';
  dialog.setAttribute('aria-labelledby', 'portable-update-title');
  dialog.innerHTML = '<h2 id="portable-update-title">更新便携版</h2><p role="status" aria-live="polite"></p><p><a href="https://github.com/KazamiSora/wuwa-matrix-planner/releases" target="_blank" rel="noopener noreferrer">前往发布页下载 ZIP ↗</a></p><input type="file" accept=".zip" hidden><div class="plan-dialog-actions"><button data-close>关闭</button><button data-pick>选择 ZIP</button><button class="primary" data-apply hidden>更新并重启</button></div>';
  document.body.append(dialog);
  const status = dialog.querySelector('[role=status]');
  const input = dialog.querySelector('input');
  const pick = dialog.querySelector('[data-pick]');
  const apply = dialog.querySelector('[data-apply]');
  const close = dialog.querySelector('[data-close]');
  let ticket;
  let target;
  let busy = false;
  const hint = '当前版本 v' + version + '。将下载好的 Windows 便携 ZIP 拖进窗口，或点击“选择 ZIP”。';
  function lock(value) {
    busy = value;
    close.disabled = pick.disabled = apply.disabled = value;
  }
  function open() {
    if (!dialog.open) { status.textContent = hint; dialog.showModal(); }
  }
  async function post(action, body, extra = {}) {
    const response = await fetch('/__update/' + action, {
      method: 'POST', headers: { ...headers, ...extra, ...(ticket ? { 'X-Update-Id': ticket } : {}) }, body
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '更新请求失败，请重试。');
    return result;
  }
  async function select(file) {
    if (busy || ticket || !file) return;
    open();
    try { newerPackageVersion(file.name, version); }
    catch (error) { status.textContent = error.message; input.value = ''; return; }
    lock(true);
    status.textContent = '正在解压并校验 ' + file.name + '…';
    try {
      const result = await post('prepare', file, { 'Content-Type': 'application/zip', 'X-Package-Name': file.name });
      ticket = result.id;
      target = result.version;
      status.textContent = 'v' + version + ' → v' + target + '。请确认包体来自可信来源。继续后将备份已保存的排布并重启。';
      apply.hidden = false;
      pick.hidden = true;
      close.textContent = '取消';
    } catch (error) { status.textContent = error.message; }
    finally { lock(false); input.value = ''; }
  }
  async function cancel() {
    if (busy) return;
    lock(true);
    try { if (ticket) await post('cancel'); }
    catch { /* Expired preparations are already discarded. */ }
    finally {
      ticket = null; apply.hidden = true; pick.hidden = false; close.textContent = '关闭';
      lock(false); dialog.close();
    }
  }
  entry.onclick = open;
  window.addEventListener('pagehide', () => {
    if (ticket && !busy) fetch('/__update/cancel', {
      method: 'POST', keepalive: true, headers: { ...headers, 'X-Update-Id': ticket }
    }).catch(() => {});
  });
  close.onclick = cancel;
  dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
  pick.onclick = () => input.click();
  input.onchange = () => select(input.files[0]);
  function listen(doc) {
    for (const name of ['dragover', 'drop']) doc.addEventListener(name, event => {
      if (!event.dataTransfer.types.includes('Files')) return;
      if (doc !== document && name === 'drop' && !Array.from(event.dataTransfer.files).some(f => /\.zip$/i.test(f.name))) return;
      event.preventDefault();
      if (name === 'drop') {
        event.stopImmediatePropagation();
        select(event.dataTransfer.files[0]);
      }
    }, true);
  }
  listen(document);
  for (const frame of document.querySelectorAll('iframe')) {
    const attach = () => { try { if (frame.contentDocument) listen(frame.contentDocument); } catch {} };
    frame.addEventListener('load', attach); attach();
  }
  apply.onclick = async () => {
    if (busy || !ticket) return;
    lock(true);
    try {
      const health = await (await fetch('/__matrix_health')).json();
      const backup = Object.fromEntries(Object.entries(localStorage).filter(([k]) => /^(wuwa-|afyg-)/.test(k)));
      const result = await post('apply', JSON.stringify(backup), { 'Content-Type': 'application/json' });
      status.textContent = '正在重启，完成后此窗口会自动刷新。';
      for (let i = 0; i < 120; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          const state = await (await fetch('/__matrix_health', { cache: 'no-store', signal: AbortSignal.timeout(1500) })).json();
          if (state.root !== health.root || state.pid === health.pid) continue;
          if (state.version === target) { location.reload(); return; }
          if (state.version === version) {
            status.textContent = '更新失败，已恢复 v' + version + '。详情见 ' + result.work + ' 中的 update.log。';
            break;
          }
        } catch {}
        if (i === 119) status.textContent = '重启尚未完成。请查看 ' + result.work + ' 中的 update.log 和排布备份。';
      }
      ticket = null; apply.hidden = true; pick.hidden = false; close.textContent = '关闭';
    } catch (error) { status.textContent = error.message; }
    finally { lock(false); }
  };
}
init().catch(console.error);
