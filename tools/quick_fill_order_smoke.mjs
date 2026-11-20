import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('wuwa-quick-pairs-v1',JSON.stringify([['1311','1312'],['1102','1103'],['1505','1512'],['1104','1203'],['1603','1602']])));
 await page.goto(process.env.MATRIX_URL||'http://127.0.0.1:13735/');await page.locator('#plan-select option').first().waitFor({state:'attached'});
 await page.locator('#new-plan').click();await page.locator('#confirm-plan').click();await page.locator('#quick-team').click();
 await page.locator('#pair-presets summary').click();
 const cards=page.locator('#quick-team-preview .quick-preview-team');
 const active=async index=>assert.equal(await cards.nth(index).getAttribute('aria-pressed'),'true');
 const pick=name=>page.locator('#character-grid').getByRole('button',{name,exact:true}).click();
 const names=index=>cards.nth(index).locator('img').evaluateAll(ns=>ns.map(n=>n.alt));
 await page.locator('#apply-all-pairs').click();assert.equal(await page.locator('#pair-presets').evaluate(el=>el.open),false);await active(0);await pick('炽霞');assert.equal((await names(0))[2],'炽霞');await active(1);
 await cards.nth(3).locator('strong').click();await active(3);await pick('维里奈');await active(4);
 await page.locator('#quick-undo').click();await active(3);await page.locator('#quick-redo').click();await active(4);
 await pick('长离');await active(1);await pick('莫宁');await active(2);await pick('折枝');assert.equal(await cards.count(),5);
 assert.equal((await names(3))[2],'维里奈');assert.equal((await names(4))[2],'长离');await pick('今汐');assert.deepEqual(await names(5),['今汐']);
 await page.locator('#quick-reset').click();await pick('炽霞');await page.locator('#pair-presets summary').click();await page.locator('#apply-all-pairs').click();await active(0);await cards.nth(5).click();await active(5);await pick('维里奈');await active(5);await pick('长离');await active(0);
 assert.deepEqual(await names(5),['炽霞','维里奈','长离']);await page.locator('#confirm-characters').click();
 const teams=await page.evaluate(()=>JSON.parse(localStorage.getItem('wuwa-matrix-demo-v1')).teams);
 assert.deepEqual(teams.map(t=>t.characterIds.length),[3,2,2,2,2,2]);assert.deepEqual(errors,[]);
 console.log('PASS first reserved slot, card-selected start, sequential fill, wraparound, undo/redo, partial last team and append.');
}finally{await browser.close();}
