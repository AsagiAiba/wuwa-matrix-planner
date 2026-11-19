import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {buildSeasonScores} from '../season-config.js';
import {locateScore,packTeams} from '../score-axis.js';
const {chromium}=await import(pathToFileURL(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
const example=JSON.parse(await readFile('config/demo.json','utf8'));
const url=process.env.MATRIX_URL||'http://127.0.0.1:4173';
const numeric=text=>Number(text.replace(/[^\d.-]/g,''));
async function check(amount,season='s2-phase3') {
  assert.equal(numeric(await page.locator('#current-total-value').innerText()), Math.round(amount*10)/10);
  const expected=locateScore(amount,buildSeasonScores(season).records);
  assert.equal(await page.locator('#current-total-position strong').innerText(),`R${expected.wave.round} ${expected.wave.name}`);
  const values=await page.locator('#current-total-progress .remaining-score-value').allTextContents();
  const consumed=expected.wave.full_kill_points-expected.remainingPoints;
  assert.ok(Math.abs(numeric(values[0])-consumed)<.051);
  assert.ok(Math.abs(numeric(values[1])-expected.remainingPoints)<.051);
  const percentages=await page.locator('.current-total-percent').allTextContents();
  assert.equal(percentages[0],`${(consumed/expected.wave.full_kill_points*100).toFixed(1)}%`);
  assert.equal(percentages[1],`${(expected.remainingPoints/expected.wave.full_kill_points*100).toFixed(1)}%`);
  assert.ok(Math.abs(numeric(percentages[0])+numeric(percentages[1])-100)<.11);
}
async function fixture(config) {
  await page.evaluate(config=>{localStorage.setItem('wuwa-matrix-plan-library-v1',JSON.stringify({version:1,activePlanId:'total-check',plans:[{id:'total-check',name:'总分验证',config}]}));},config);
  await page.reload(); await page.locator('#current-total-position strong').waitFor();
}
try {
 await mkdir('outputs',{recursive:true});await page.goto(url);await page.locator('.team-bar').first().waitFor();
 await check(24000);
 assert.equal(await page.locator('.legend').count(),0);
 const heading=await page.locator('.current-total-heading').boundingBox();
 const details=await page.locator('.current-total-details').boundingBox();
 const controls=await page.locator('.timeline-toolbar > .view-controls').boundingBox();
 const summary=await page.locator('.current-total-summary').boundingBox();
 const controlLabel=await page.locator('.view-controls label').boundingBox();
 assert.ok(details.x>=heading.x+heading.width && details.y<heading.y+heading.height && details.y+details.height>heading.y);
 assert.ok(controls.y>=summary.y+summary.height && Math.abs(controlLabel.x-summary.x)<2);
 await page.locator('.timeline-toolbar').screenshot({path:'outputs/current-total-toolbar.png'});
 await page.locator('#team-score').fill('1w');await page.locator('#apply-team').click();await check(26000);
 page.once('dialog', dialog => dialog.accept()); await page.locator('#delete-team').click();await check(16000);
 await page.reload();await page.locator('.team-bar').first().waitFor();await check(16000);
 const pending=structuredClone(example);pending.teams[0].score=0;pending.teams[0].needsScore=true;pending.teams=packTeams(pending.teams);
 await fixture(pending);await check(16000);assert.match(await page.locator('#current-total-pending').innerText(),/1 队待填/);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.locator('.timeline-toolbar').screenshot({path:'outputs/current-total-mobile.png'});
 for(const amount of [0,4680,24887,3319829]){
  const config=structuredClone(example);config.maxRound=15;config.teams=amount?[{...config.teams[0],score:amount,startScore:0}]:[];
  await fixture(config);await check(amount);
  if(amount===24887)assert.match(await page.locator('#current-total-position').innerText(),/击杀奖励区/);
  if(amount===3319829)assert.match(await page.locator('#current-total-position').innerText(),/已完成全部血线/);
 }
 await page.setViewportSize({width:1440,height:1050});
 const outsideView=structuredClone(example);outsideView.maxRound=1;outsideView.teams=[{...outsideView.teams[0],score:100000,startScore:0}];
 await fixture(outsideView);await check(100000);
 await page.locator('#max-round').selectOption('1');await check(100000);
 const phase4={...structuredClone(example),towerId:18,matrixSeason:'s2-phase4',matrixVersion:'终焉矩阵S2-4（S2第四阶段）',staminaSeason:'s2-phase4'};
 await fixture(phase4);await check(24000,'s2-phase4');
 assert.deepEqual(errors,[]);
 console.log('PASS: actual total, per-Boss points/percentages, pending exclusion, edit/delete/reload, zero/exact boundary/chest bonus/full completion, display-range independence, both seasons and mobile.');
}finally{await browser.close();}
