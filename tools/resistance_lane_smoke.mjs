import assert from 'node:assert/strict';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const p=await b.newPage({viewport:{width:1440,height:950}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.MATRIX_URL||'http://127.0.0.1:13735/');
 await p.locator('.team-bar').first().waitFor();await p.locator('#new-plan').click();assert.equal(await p.locator('#plan-season').inputValue(),'s2-phase4');await p.locator('#confirm-plan').click();
 const plan=await p.evaluate(()=>JSON.parse(localStorage.getItem('wuwa-matrix-demo-v1')));assert.equal(plan.matrixSeason,'s2-phase4');
 plan.maxRound=2;plan.teams=[{id:'wind',name:'双气动',characterIds:['1404','1405','1205'],score:2000,startScore:0,color:'#aaaaff'},{id:'fire',name:'火风',characterIds:['1203','1406','1103'],score:24000,startScore:2000,color:'#aaffaa'}];
 await p.locator('#import-file').setInputFiles({name:'resistance.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(plan))});
 await p.locator('.resist-mark[data-team="wind"]').waitFor();await p.locator('#fit-teams').click();
 const match=(id,w)=>p.locator('.resist-mark[data-team="'+id+'"][data-wave="'+w+'"]');
 assert.match(await match('wind',1).getAttribute('class'),/resist-solid/);await match('wind',1).hover();
 const tip=p.locator('#team-tooltip');assert.match(await tip.innerText(),/顶气动抗性/);assert.deepEqual(await tip.locator('img').evaluateAll(imgs=>imgs.map(i=>i.alt)),['忌炎','鉴心']);
 assert.match(await match('fire',1).getAttribute('class'),/resist-striped/);await match('fire',1).hover();assert.equal(await tip.locator('img').count(),1);assert.equal(await tip.locator('img').getAttribute('alt'),'漂泊者·气动');
 assert.match(await match('fire',2).getAttribute('class'),/resist-solid/);assert.equal(await match('fire',5).count(),0);assert.equal(await match('fire',6).count(),1);
 const scale=await p.locator('.team-bar[data-id="wind"]').evaluate(n=>parseFloat(n.style.width)/2000);assert.ok(Math.abs(await match('fire',1).evaluate(n=>parseFloat(n.style.width))-2680*scale)<.05);
 await p.locator('.team-card[data-id="fire"]').click();await p.locator('#main-carry').selectOption('1406');assert.equal(await p.locator('#sub-carry').inputValue(),'1203');assert.match(await match('fire',1).getAttribute('class'),/resist-solid/);assert.match(await match('fire',2).getAttribute('class'),/resist-striped/);
 await p.reload();await match('fire',1).waitFor();assert.match(await match('fire',2).getAttribute('class'),/resist-striped/);
 await p.locator('.team-card[data-id="fire"]').click();await p.locator('#default-carries').click();assert.match(await match('fire',1).getAttribute('class'),/resist-striped/);
 const layout=await p.evaluate(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect();return [rect('.boss-row').top-rect('.round-row').bottom,rect('.boss-segment').top-rect('.boss-row').top,rect('#resistance-lane').top-rect('.boss-segment').bottom,document.querySelector('.round-bracket').textContent]});assert.deepEqual(layout,[0,0,0,'R1']);assert.deepEqual(errors,[]);
 console.log('PASS default season, role swap/reset/persistence, exact interval intersections, hovered portraits for both and sub-only, no chest marker, and flush geometry.');
}finally{await b.close();}
