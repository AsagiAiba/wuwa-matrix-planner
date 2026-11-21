import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdir,readFile,mkdtemp} from 'node:fs/promises';
const {chromium}=await import(pathToFileURL(process.env.MATRIX_PLAYWRIGHT||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const url=process.env.MATRIX_URL||'http://127.0.0.1:4173';
const options={executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true};
await mkdir('outputs',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/backup-roundtrip-'));
const file=path.join(dir,'four-teams.json'),profile=path.join(dir,'profile');
const libKey='wuwa-matrix-plan-library-v1';
let browser,context,page;const errors=[];
async function open(ctx){
 page=await ctx.newPage();page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('#quick-team:enabled').waitFor();
}
const library=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),libKey);
async function active(){const lib=await library();return lib.plans.find(p=>p.id===lib.activePlanId);}
async function pick(cfg){await page.locator('#toast').evaluate(el=>el.classList.remove('visible'));await page.locator('#import-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.isBuffer(cfg)?cfg:Buffer.from(JSON.stringify(cfg))});}
async function selected(name){
 await page.waitForFunction(n=>document.querySelector('#plan-select')?.selectedOptions[0]?.textContent===n ||
   document.querySelector('#toast.visible')?.textContent.startsWith('导入失败'),name);
 assert.equal(await page.locator('#plan-select option:checked').textContent(),name,await page.locator('#toast').textContent());
}
async function download(button,f){const event=page.waitForEvent('download');await page.locator(button).click();await (await event).saveAs(f);}
try{
 browser=await chromium.launch(options);await open(await browser.newContext());
 await page.locator('#batch-afyg').click();await page.locator('#batch-afyg-confirm').click();
 await page.locator('.team-bar').first().waitFor();
 const fixture=await page.evaluate(k=>{
  const lib=JSON.parse(localStorage.getItem(k)),config=structuredClone(lib.plans.find(p=>p.id===lib.activePlanId).config),original=config.teams[0];
  const groups=[original.characterIds,['1304','1205','1505'],['1305','1302','1503'],['1603','1602','1103']];
  config.teams=groups.map((roles,i)=>{
   const t=structuredClone(original);t.characterIds=roles;t.projectPreset.roles=roles;t.name='回归队 '+(i+1);t.nameMode='custom';t.id='regression-'+i;
   t.projectPreset.name=t.name+' 启动＋循环';t.resistanceRoles={main:roles[0],sub:roles[1]};
   for(const h of t.projectPreset.hits)for(const profile in h.damage)h.damage[profile]=Math.round(h.damage[profile]*(1+i/8));
   return t;
  });
  // Grow the workload using additional real, referenced hit rows, not whitespace or discarded filler.
  while(new Blob([JSON.stringify(config)]).size<=1100000){
   for(const t of config.teams){const p=t.projectPreset,offset=p.hits.length;
    p.hits.push(...structuredClone(p.hits));p.roundOrders=p.roundOrders.map(order=>order.flatMap(i=>[i,i+offset]));}
  }
  config.maxRound=15;config.scoreMarker=25000;config.planName='四队大轴';
  return config;
 },libKey);
 await pick(fixture);await selected('四队大轴');await download('#export-button',file);
 const bytes=await readFile(file),payload=JSON.parse(bytes);
 assert.ok(bytes.length>1000000);assert.equal(bytes.toString(),JSON.stringify(payload));assert.equal(payload.teams.length,4);
 for(let i=0;i<4;i++)assert.deepEqual(payload.teams[i].projectPreset,fixture.teams[i].projectPreset);
 console.log('Four-team compact download:',bytes.length,'bytes, hit rows:',payload.teams.map(t=>t.projectPreset.hits.length));
 await browser.close();browser=null;
 context=await chromium.launchPersistentContext(profile,options);await open(context);
 assert.equal(await page.evaluate(()=>localStorage.getItem('afyg-project-library-v1')),null);
 const cleanLibrary=await library();
 await page.evaluate(()=>{
   const chunk='x'.repeat(128*1024);
   try{for(let i=0;i<512;i++)localStorage.setItem('qa-quota-'+i,chunk);}
   catch(e){if(e.name==='QuotaExceededError')return;throw e;}
   throw Error('browser quota was not reached');
 });
 await page.locator('#import-file').setInputFiles(file);
 await page.locator('#toast').filter({hasText:/导入失败.*写入失败/}).waitFor();
 assert.deepEqual(await library(),cleanLibrary);
 assert.equal(await page.locator('#plan-select').inputValue(),cleanLibrary.activePlanId);
 await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('qa-quota-'))localStorage.removeItem(k);});
 await page.locator('#toast').evaluate(el=>el.classList.remove('visible'));
 console.log('PASS real full localStorage: no partial plan or selection change; retry after freeing space');
 await page.locator('#import-file').setInputFiles(file);await selected('四队大轴');
 const restored=await active();assert.deepEqual({...restored.config,planName:restored.name},payload);
 await page.reload();await selected('四队大轴');assert.deepEqual(await active(),restored);
 await context.close();context=await chromium.launchPersistentContext(profile,options);await open(context);
 assert.deepEqual(await active(),restored);
 await page.locator('.team-bar[data-id="regression-0"]').press('ArrowRight');
 const reordered=await active();assert.deepEqual(reordered.config.teams.map(t=>t.id),['regression-1','regression-0','regression-2','regression-3']);
 const old=restored.config.teams.find(t=>t.id==='regression-1'),first=reordered.config.teams[0];
 assert.ok(old.startScore>0 && first.startScore===0 && first.score>0 && first.score!==old.score);
 for(const team of reordered.config.teams)assert.deepEqual(team.projectPreset,payload.teams.find(t=>t.id===team.id).projectPreset);
 await page.reload();await selected('四队大轴');assert.deepEqual(await active(),reordered);
 console.log('Restart and re-simulation verified:',old.score,'->',first.score);
 await context.close();context=null;
 browser=await chromium.launch(options);await open(await browser.newContext());
 // Reproduce the two reported byte sizes using a deterministic v1 fixture derived from the real snapshot.
 const sized=structuredClone(payload);sized.teams=sized.teams.slice(0,1);sized.planName='旧版容量边界';
 const pr=sized.teams[0].projectPreset;
 const originalHits=[...pr.hits];let bytesUsed=Buffer.byteLength(JSON.stringify(sized));
 for(let i=0;i<originalHits.length;i++){
   const row=originalHits[i],idx=pr.hits.length;
   const extra=Buffer.byteLength(JSON.stringify(row))+String(idx).length+2;
   if(bytesUsed+extra+32>699787)break;
   pr.hits.push(row);pr.roundOrders[0].push(idx);bytesUsed+=extra;
 }
 sized.description='';sized.description='x'.repeat(699787-Buffer.byteLength(JSON.stringify(sized)));
 const compact=Buffer.from(JSON.stringify(sized));assert.equal(compact.length,699787);
 const padded=Buffer.concat([Buffer.from('{\n'),Buffer.alloc(1079024-compact.length-1,32),compact.subarray(1)]);
 assert.equal(padded.length,1079024);
 await pick(padded);await selected('旧版容量边界');console.log('PASS old 1079024-byte file');const prettyPlan=await active();
 await pick(compact);await selected('旧版容量边界（2）');console.log('PASS old 699787-byte file');assert.deepEqual((await active()).config,prettyPlan.config);
 const legacyEngine=structuredClone(sized);legacyEngine.planName='旧算法快照';delete legacyEngine.teams[0].projectPreset.matrixLevelVersion;
 await pick(legacyEngine);await selected('旧算法快照');const legacyPreset=(await active()).config.teams[0];
 assert.equal(legacyPreset.score,legacyEngine.teams[0].score);assert.deepEqual(legacyPreset.projectPreset,legacyEngine.teams[0].projectPreset);
 const originalLibrary=await library();
 async function rejectInput(data,reason){
   await pick(data);await page.locator('#toast').filter({hasText:reason}).waitFor();
   assert.deepEqual(await library(),originalLibrary);
 }
 const invalid=structuredClone(sized);invalid.teams[0].projectPreset.roundOrders[0][0]=999999;
 await rejectInput(invalid,/导入失败.*工程预设/);
 const invalidDamage=structuredClone(sized);invalidDamage.teams[0].projectPreset.hits[0].damage=123;
 await rejectInput(invalidDamage,/导入失败.*工程预设/);
 const missing=structuredClone(sized);missing.teams[0].projectPreset.hits.find(h=>!h.castOnly).damage={unknown:1};
 await rejectInput(missing,/导入失败.*抗性/);
 await rejectInput({...sized,teams:Array(41).fill(null)},/导入失败/);
 await rejectInput(Buffer.from('{"version":1,'),/导入失败/);
 console.log('PASS matching legacy byte sizes, invalid hit indexes, damage maps and team count');
 const demo=JSON.parse(await readFile('tests/fixtures/demo.json'));
 // A pre-season v1 export, including indentation, BOM and an existing stamina conflict.
 delete demo.matrixSeason;delete demo.matrixVersion;demo.planName='旧版方案';demo.teams[1].characterIds[0]=demo.teams[0].characterIds[0];
 await pick(Buffer.from('\uFEFF'+JSON.stringify(demo,null,2)));await selected('旧版方案');
 assert.deepEqual((await active()).config.teams.map(t=>t.characterIds),demo.teams.map(t=>t.characterIds));
 await page.reload();await selected('旧版方案');const before=await library();
 // A failed authoritative write must not change either the selected UI or the stored library.
 await page.evaluate(key=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('容量测试','QuotaExceededError');return set.call(this,k,v);};},libKey);
 await pick({...demo,planName:'应当失败'});await page.locator('#toast').filter({hasText:/导入失败/}).waitFor();
 assert.deepEqual(await library(),before);await selected('旧版方案');await page.reload();await selected('旧版方案');
 await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='wuwa-matrix-demo-v1')throw new DOMException('镜像写满','QuotaExceededError');return set.call(this,k,v);};});
 await pick({...demo,planName:'仅镜像失败'});await selected('仅镜像失败');await page.reload();await selected('仅镜像失败');
 const current=await active(),small=path.join(dir,'verify.json');
 await page.locator('#delete-plan').click();await download('#export-delete-plan',small);
 const verify=page.locator('#verify-delete-file'),confirm=page.locator('#confirm-delete-plan');
 assert.ok(await confirm.isDisabled());await verify.setInputFiles({name:'wrong.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...current.config,planName:'其他方案'}))});
 await page.locator('#delete-plan-error').filter({hasText:'不一致'}).waitFor();assert.ok(await confirm.isDisabled());
 await verify.setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{')});await page.locator('#delete-plan-error').filter({hasText:'验证失败'}).waitFor();assert.ok(await confirm.isDisabled());
 await verify.setInputFiles(small);await page.locator('#confirm-delete-plan:enabled').waitFor();
 // A change from another window after verification must invalidate deletion.
 await page.evaluate(k=>{const lib=JSON.parse(localStorage.getItem(k));lib.plans.find(p=>p.id===lib.activePlanId).name='另窗重命名';localStorage.setItem(k,JSON.stringify(lib));},libKey);
 await confirm.click();await page.locator('#delete-plan-error').filter({hasText:'已变化'}).waitFor();
 await page.locator('#cancel-delete-plan').click();await page.reload();await selected('另窗重命名');
 await page.locator('#delete-plan').click();await download('#export-delete-plan',small);await verify.setInputFiles(small);await page.locator('#confirm-delete-plan:enabled').waitFor();await confirm.click();
 await page.reload();assert.ok(!(await library()).plans.some(p=>p.id===current.id));
 // Verification is a dry run: a full library can still export, verify and delete.
 await page.evaluate(k=>{const lib=JSON.parse(localStorage.getItem(k)),base=lib.plans[0];while(lib.plans.length<100)lib.plans.push({...base,id:'fill-'+lib.plans.length});localStorage.setItem(k,JSON.stringify(lib));},libKey);
 await page.reload();await page.locator('#quick-team:enabled').waitFor();const full=await library();
 await pick(demo);await page.locator('#toast').filter({hasText:'最多保留 100 套'}).waitFor();assert.deepEqual(await library(),full);
 await page.locator('#delete-plan').click();await download('#export-delete-plan',small);await verify.setInputFiles(small);
 await page.locator('#confirm-delete-plan:enabled').waitFor();await confirm.click();assert.equal((await library()).plans.length,99);
 assert.deepEqual(errors,[]);console.log('PASS legacy, storage failures, file read-back, stale snapshot, verified deletion');
}finally{await context?.close();await browser?.close();}
