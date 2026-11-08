import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const baseUrl = process.env.MATRIX_URL || 'http://127.0.0.1:4173';
const errors = []; page.on('pageerror', error => errors.push(error.message));
const source = JSON.parse(await readFile('data/scores.json', 'utf8')).records;
const number = async id => Number((await page.locator(`#${id}`).innerText()).replace(/[^\d.-]/g, ''));
const close = async () => { await page.keyboard.press('Escape'); assert.equal(await page.locator('#boss-dialog').isVisible(), false); };
async function checkPoints(wave, percent) {
  await page.locator('#boss-hp-percent').fill(String(percent));
  const earned = percent === 0 ? wave.full_kill_points : wave.damage_points_at_full_hp * (1 - percent / 100);
  assert.ok(Math.abs(await number('boss-earned-points') - earned) <= .051);
  assert.ok(Math.abs(await number('boss-remaining-points') - (wave.full_kill_points - earned)) <= .051);
}
try {
  await mkdir('outputs', { recursive: true });
  await page.goto(baseUrl);
  await page.locator('.boss-segment').first().click();
  assert.equal(await page.locator('#boss-dialog-title').innerText(), 'R1 燎照之骑');
  assert.equal(await number('boss-total-hp'), 5612519);
  assert.equal(await page.locator('#boss-resistances img').count(), 6);
  assert.deepEqual(await page.locator('#boss-resistances strong').allTextContents(), ['20%', '40%', '20%', '20%', '20%', '20%']);
  assert.equal(await page.locator('#boss-resistance-note').isVisible(), false);
  await page.waitForFunction(() => [...document.querySelectorAll('#boss-resistances img')].every(image => image.complete && image.naturalWidth > 0));
  for (const percent of [100, 75, 37.25, 0]) await checkPoints(source[0], percent);
  for (const invalid of ['', '-1', '101']) {
    await page.locator('#boss-hp-percent').fill(invalid);
    assert.equal(await page.locator('#boss-hp-percent').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#boss-earned-points').innerText(), '—');
    assert.equal(await page.locator('#boss-remaining-points').innerText(), '—');
  }
  await checkPoints(source[0], 37.25);
  await page.locator('#boss-dialog').screenshot({ path: 'outputs/boss-details-desktop.png' });
  await close();
  assert.equal(await page.locator('.boss-segment').first().evaluate(node => document.activeElement === node), true);
  await page.keyboard.press('Enter'); assert.equal(await page.locator('#boss-dialog').isVisible(), true); await close();
  await page.locator('.boss-segment').nth(4).click();
  assert.equal(await page.locator('#boss-dialog-title').innerText(), 'R1 矩阵奇藏');
  assert.deepEqual(await page.locator('#boss-resistances strong').allTextContents(), Array(6).fill('20%'));
  assert.match(await page.locator('#boss-calculation-note').innerText(), /0%.*1,000.*击杀奖励/);
  for (const percent of [100, 50, .001, 0]) await checkPoints(source[4], percent);
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await page.locator('#boss-dialog').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390);
  await page.locator('#boss-dialog').screenshot({ path: 'outputs/boss-details-mobile.png' });
  await close(); await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('#max-round').selectOption('4');
  await page.locator('.boss-segment').nth(15).click();
  assert.match(await page.locator('#boss-total-hp-label').innerText(), /推算/);
  assert.equal(await page.locator('#boss-total-points-label').innerText(), '总分数');
  assert.ok(Math.abs(await number('boss-total-hp') - 19388951 * 1.05) < .051); await close();
  await page.locator('#new-plan').click(); await page.locator('#plan-name').fill('Boss详情S2-4');
  await page.locator('#plan-season').selectOption('s2-phase4'); await page.locator('#confirm-plan').click();
  await page.locator('.boss-segment').first().click();
  assert.equal(await page.locator('#boss-dialog-title').innerText(), 'R1 飞廉之猩');
  assert.deepEqual(await page.locator('#boss-resistances strong').allTextContents(), ['20%', '20%', '20%', '40%', '20%', '20%']);
  assert.equal(await number('boss-total-hp'), 5612519);
  assert.equal(await page.locator('#boss-total-hp-label').innerText(), '总血量（暂定）');
  assert.match(await page.locator('#boss-data-basis').innerText(), /血量暂按 S2-3 相同轮次、相同出场位次/);
  assert.match(await page.locator('#boss-total-points-label').innerText(), /暂定/);
  await checkPoints(source[0], 50);
  await page.locator('#boss-dialog').screenshot({ path: 'outputs/boss-details-s2-4.png' });
  await page.locator('#close-boss-dialog').click(); assert.equal(await page.locator('#boss-dialog').isVisible(), false);
  for (const [index, name, expected] of [[1, '达妮娅', ['20%', '40%', '20%', '20%', '20%', '20%']], [3, '辛吉勒姆', ['20%', '20%', '20%', '20%', '40%', '20%']]]) {
    await page.locator('.boss-segment').nth(index).click();
    assert.equal(await page.locator('#boss-dialog-title').innerText(), `R1 ${name}`);
    assert.equal(await page.locator('#boss-total-hp-label').innerText(), '总血量（暂定）');
    assert.deepEqual(await page.locator('#boss-resistances strong').allTextContents(), expected);
    await close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Boss click/keyboard/close, all element icons, HP provenance, percent validation, fractional scores, chest kill-bonus boundary, S2-4 and mobile.');
} finally { await browser.close(); }
