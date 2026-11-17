import assert from 'node:assert/strict';import os from 'node:os';import path from 'node:path';import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
const page=await browser.newPage({viewport:{width:1440,height:1050}});await page.goto((process.env.MATRIX_URL || 'http://127.0.0.1:4173'));await page.locator('.team-bar').first().waitFor();await page.locator('#boss-properties-details > summary').click();await page.waitForTimeout(250);
for(const [season,file,expected] of [['S1-3','T_IconMonsterHead_215_UI.webp','无特殊增伤性质'],['S2-1','T_IconMonsterHead_195_UI.webp','敌方所受到的湮灭伤害最终提升10%，当受虚湮效应影响时，该效果提升至40%。']]){
await page.locator('#boss-season-filters').getByRole('button',{name:season,exact:true}).click();const card=page.locator('.boss-property-card').filter({has:page.getByRole('heading',{name:'矩阵集群',exact:true})});assert.equal(await card.count(),1);assert.ok((await card.locator('img').getAttribute('src')).endsWith(file));await card.locator('img').evaluate(image=>image.decode());assert.equal(await card.locator('.boss-properties-copy').innerText(),expected);await card.screenshot({path:`outputs/cluster-${season}.png`});}
await page.locator('#boss-season-filters').getByRole('button',{name:'全部',exact:true}).click();await page.locator('#boss-properties-search').fill('奏谕乐师');assert.equal(await page.locator('.boss-property-card').count(),1);assert.match(await page.locator('#boss-properties-list').innerText(),/当受虚湮效应影响时/);
await page.locator('#boss-properties-search').fill('炉芯');const furnace=await page.locator('#boss-properties-list').innerText();assert.doesNotMatch(furnace,/炽能斩|经历数次逆势回击/);assert.match(furnace,/100%.*30秒/s);
await page.locator('#boss-properties-search').fill('朔雷');assert.match(await page.locator('#boss-properties-list').innerText(),/20%.*上限提升2层.*附加的2层.*仅可触发1次/s);
await page.locator('#boss-properties-search').fill('伤痕');assert.match(await page.locator('#boss-properties-list').innerText(),/受到聚爆效应最终伤害提升100%/);
console.log('PASS: distinct cluster portraits and corrected Void Havoc condition; exact Thunder/Furnace/Scar properties and representative-name search.');
}finally{await browser.close();}
