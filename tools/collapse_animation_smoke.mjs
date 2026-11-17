import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
const page=await browser.newPage({viewport:{width:1440,height:1050}});
await page.goto((process.env.MATRIX_URL || 'http://127.0.0.1:4173'));
await page.locator('.team-bar').first().waitFor();
assert.ok(await page.evaluate(()=>CSS.supports('interpolate-size','allow-keywords') && CSS.supports('transition-behavior','allow-discrete')));
for(const id of ['circuit-buffs','boss-properties-details','other-enhancements']) {
 const panel=page.locator('#'+id), summary=panel.locator('summary');await summary.scrollIntoViewIfNeeded();
 const sample=()=>panel.evaluate(node=>({open:node.open,opacity:Number(getComputedStyle(node,'::details-content').opacity),height:node.getBoundingClientRect().height,animations:node.getAnimations({subtree:true}).map(a=>a.transitionProperty)}));
 const closed=await sample();assert.equal(closed.open,false);
 await summary.click();await page.waitForTimeout(60);const opening=await sample();
 assert.equal(opening.open,true);assert.ok(opening.opacity>0 && opening.opacity<1,JSON.stringify(opening));
 await page.waitForTimeout(240);const expanded=await sample();assert.equal(expanded.opacity,1);assert.ok(expanded.height>closed.height);
 await summary.click();await page.waitForTimeout(60);const closing=await sample();assert.equal(closing.open,false);assert.ok(closing.opacity>0 && closing.opacity<1,JSON.stringify(closing));
 await summary.click();await page.waitForTimeout(260);assert.equal((await sample()).opacity,1);
 await summary.focus();await page.keyboard.press('Enter');await page.waitForTimeout(260);assert.equal((await sample()).open,false);
}
await page.locator('#boss-properties-details > summary').click();await page.waitForTimeout(250);
await page.locator('#boss-season-filters').getByRole('button',{name:'S2-4',exact:true}).click();
await page.locator('#boss-properties-details').screenshot({path:'outputs/boss-synced-order.png'});
await page.emulateMedia({reducedMotion:'reduce'});
await page.locator('#circuit-buffs > summary').click();assert.equal(await page.locator('#circuit-buffs').evaluate(node=>getComputedStyle(node,'::details-content').transitionDuration),'0s');
await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
console.log('PASS: opening/closing opacity and height transitions, rapid reversal, keyboard toggle, reduced-motion and mobile.');
}finally{await browser.close();}
