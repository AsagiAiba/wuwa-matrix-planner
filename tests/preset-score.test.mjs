import assert from 'node:assert/strict';
import test from 'node:test';
import {simulatePreset,circuitDamageRules,matrixFinalFactor} from '../score-axis.js';
import {projectAxisRange,fullAxisTimes} from '../afyg-preset.js';

test('full-axis startup and repeated cycle duration labels accumulate to the 120s end',()=>{
 const refs=['','30s启动','25s循环','25s循环','25s循环','结束'].map((name,i)=>({id:['left','a','b','c','d','right'][i],name,pos:i*100}));
 assert.deepEqual([...fullAxisTimes({matrixAxisType:'full'},refs).values()],[0,30,55,80,105,120]);
 assert.equal(fullAxisTimes({},refs).has('right'),false);
 assert.equal(fullAxisTimes({},[refs[0],refs[1],{id:'b',name:'55s循环'}]),null);
 const authored={matrixAxisType:'full',analysis:{timings:[{refLineId:'b',seconds:56}]}};
 assert.deepEqual([...fullAxisTimes(authored,refs).values()],[0,30,56,81,106,120]);
});

import {getSeason,buildSeasonScores,enemyDefenseForLevel} from '../season-config.js';

test('a 120-second timing takes precedence over inner loop markers and includes the final position',()=>{
 const timeline={refLines:[{id:'start',name:'+0s',pos:50},{id:'loop',time:'+25s 循环轴',pos:100},{id:'right',time:'结束',pos:700}]};
 const project={analysis:{timings:[{refLineId:'right',seconds:120}]}};
 assert.deepEqual(projectAxisRange(project,timeline),{start:-Infinity,end:700,inclusiveEnd:true,cycles:1});
});
test('repeat the complete single axis four times or use its explicitly marked cycle',()=>{
 const refLines=[{id:'end',time:'+25s',pos:200}];
 assert.deepEqual(projectAxisRange({},{refLines}),{start:-Infinity,end:Infinity,inclusiveEnd:false,cycles:4});
 const loop=[{id:'start',time:'+0s 首轮伤害不计算',pos:50},{id:'end',time:'+25s 循环轴',pos:200}];
 assert.deepEqual(projectAxisRange({},{refLines:loop}),{start:50,end:200,inclusiveEnd:false,cycles:4});
});
const season={bosses:[{resistances:{values:{1:20,2:20,3:20,4:20,5:20,6:20}}},{resistances:{values:{1:20,2:20,3:40,4:20,5:20,6:20}}}]};
function wave(i,before,hp,bonus=0){return {round:1,name:'target'+i,boss_position:i,max_hp:hp,points_per_damage:.5,cumulative_points_before:before,damage_points_at_full_hp:Math.floor(hp*.5),cumulative_points_after:before+Math.floor(hp*.5)+bonus,kill_bonus:bonus};}
function shot(base,high){return {source:'心',name:'测试',part:1,damage:{'20,20,20,20,20,20':base,'20,20,40,20,20,20':high}};}
test('S2-4 anomaly circuit adds 25 and 80 in the final zone, refreshes, expires at 30s, and resets on retarget',()=>{
 const key='20,20,20,20,20,20',rules=circuitDamageRules('39');
 const s={id:'s2-phase4',bosses:[season.bosses[0],season.bosses[0]]};
 const hit=(t,extra={})=>({name:'测试',source:'绯雪',part:1,roundSecond:t,finalZone:1.2,damage:{[key]:120},...extra});
 const hits=[hit(0,{statusApplication:true}),hit(10,{glacioLayers:13}),hit(29,{statusApplication:true}),hit(31),hit(59,{glacioDamage:true}),hit(61,{abnormal:true})];
 const run=(seq,waves=[wave(1,0,1e6)],extra={})=>simulatePreset({hits:seq,cycles:1,roundSeconds:[120],bossEventVersion:2,...extra},s,waves,0,
   (h,b,i,active)=>matrixFinalFactor(h,b,i,rules,active),'auto',rules);
 let total=0;
 for(const [i,d] of [120,225,145,145,200,120].entries()){
   total+=d;assert.ok(Math.abs(run(hits.slice(0,i+1)).applied-total)<1e-6);
 }
 assert.equal(run([hit(0,{statusApplication:true}),hit(1)], [wave(1,0,120),wave(2,60,1000)]).applied,240);
 // Activation at t=29 persists through the loop boundary and expires at t=59.
 assert.equal(run([hit(29,{statusApplication:true}),hit(0),hit(29)],undefined,
   {cycles:2,roundSeconds:[30,30],roundOrders:[[0],[1,2]]}).applied,385);
});
test('Hiyuki grants team final damage on the first hit against Denia, including on switching targets',()=>{
 const season=getSeason('s2-phase4'),denia=season.bosses[1],other=season.bosses[4];
 const profile=b=>[1,2,3,4,5,6].map(i=>b.resistances.values[i]).join(',');
 const damage={[profile(denia)]:120,[profile(other)]:120};
 const hit=(source,extra={})=>({source,name:'普通攻击',part:1,damage,finalZone:1.2,...extra});
 const ally=hit('洛瑟菈'),frost=hit('霜渐效应',{abnormal:true,glacioLayers:13}),late=hit('穗穗',{roundSecond:40});
 const run=(hits,roles=['1109','1108'],waves=[wave(1,0,1e6)],bosses=[denia],start=0)=>
   simulatePreset({hits,cycles:1,roles,bossEventVersion:2},{...season,bosses},waves,start,()=>1);
 assert.equal(run([ally]).applied,150); // 120 base includes a 1.2 final-damage zone.
 assert.equal(run([ally,frost,late]).applied,150+175+150);
 assert.equal(run([ally,frost,late],['1109']).applied,120+145+120);
 assert.equal(run([ally],undefined,undefined,undefined,100).stages[0].hiyukiTeamFinal,30); // partial HP start
 const switched=run([ally,ally,frost,late],undefined,[wave(1,0,100),wave(2,50,300),wave(3,200,1e4)],[other,denia,other]);
 assert.equal(switched.applied,100+150+150+120);
 assert.equal(switched.stages[1].lost,25); // the second hit on Denia deals 175 before overkill.
 assert.deepEqual(switched.stages.map(s=>s.hiyukiTeamFinal),[undefined,30,undefined]);
});
test('both seasons use the verified enemy levels at every boss, including chests',()=>{
  for(const id of ['s2-phase3','s2-phase4']){
    const rows=buildSeasonScores(id).records;
    assert.equal(rows.length,75);
    for(const w of rows)assert.equal(w.enemy_level,w.round===1?100:w.round===2?110:120);
  }
  assert.deepEqual([100,110,120].map(enemyDefenseForLevel),[1592,1672,1752]);
});
test('the hit after a round boundary uses the new level and resistance, including when a team starts there',()=>{
  const waves=[{...wave(1,0,100),enemy_level:100},{...wave(2,50,10000),enemy_level:110}];
  const hit=shot(200,2000);
  hit.damage['110|20,20,40,20,20,20']=800;
  const p={matrixLevelVersion:1,cycles:1,hits:[hit,hit]};
  const r=simulatePreset(p,season,waves,0);
  assert.deepEqual(r.stages.map(s=>s.score),[50,400]);
  assert.equal(simulatePreset({...p,hits:[hit]},season,waves,50).score,400);
  assert.match(simulatePreset({...p,matrixLevelVersion:undefined},season,waves,50).reason,/重新应用/);
});
// Synthetic hits isolate stack timing without bundling an old player's rotation.
const testDamage=Object.fromEntries(getSeason('s2-phase4').bosses.map(b=>[[1,2,3,4,5,6].map(i=>b.resistances.values[i]).join(','),100]));
const heartPreset={cycles:4,bossEventVersion:2,roles:['1311','1312','1505'],hits:
 ['守岸人','锁暝','心','心'].map((source,i)=>({name:i===3?'谐度破坏':'测试',source,part:1,damage:testDamage,tuneBreak:i===3}))};
test('four heart rotations honor their individual execution slots and retain stacks across a skipped round',()=>{
  const season=getSeason('s2-phase4'),hits=heartPreset.hits;
  const normal=hits.map((_,i)=>i).filter(i=>!hits[i].tuneBreak);
  const execution=hits.findIndex(h=>h.tuneBreak);
  const orders=[[execution,...normal],normal,[...normal.slice(0,1),execution,...normal.slice(1)],[...normal,execution]];
  const report=simulatePreset({...heartPreset,roundOrders:orders},season,[wave(1,0,1e10)],0,
    (hit,boss,round)=>matrixFinalFactor(hit,boss,round,circuitDamageRules('40')));
  assert.equal(report.count,15);
  assert.deepEqual(report.stages[0].stackEvents.map(e=>[e.round,e.hit,e.stacks]),[[1,1,1],[3,9,2],[4,15,3]]);
});
test('heart preset counts four executions and three on-field first outputs on a surviving S2-4 target',()=>{
 const season=getSeason('s2-phase4');
 const run=position=>{
   const target={...wave(position,0,1e10),name:season.bosses[position-1].name};
   const report=simulatePreset(heartPreset,season,[target],0,(hit,boss,round)=>matrixFinalFactor(hit,boss,round,circuitDamageRules('40')));
   return report.stages[0];
 };
 const ape=run(1),cingulum=run(4);
 assert.deepEqual(ape.stackEvents.map(e=>e.hit),[4,8,12,16]);
 assert.deepEqual(cingulum.stackEvents.map(e=>[e.hit,e.trigger]),[[1,'守岸人首次输出'],[2,'锁暝首次输出'],[3,'心首次输出']]);
 assert.equal(ape.stacks,4);
 assert.equal(cingulum.stacks,3);
});
test('Cingulum counts each role and named cast once per spawn, while equipped Echo damage always uses two layers',()=>{
 const matrix=getSeason('s2-phase4'),boss=matrix.bosses[3],season={...matrix,bosses:[boss,boss]};
 const key=[1,2,3,4,5,6].map(i=>boss.resistances.values[i]).join(',');
 function hit(source,name,tags={}){return {source,name,part:1,damage:{[key]:100},...tags};}
 const hits=[
  hit('心','后台',{offField:true}),hit('心','普攻'),hit('仇远','穿林打叶(共鸣技能)',{echo:true}),
  hit('仇远','答剑·弦歌不辍(共鸣回路)'),hit('仇远','答剑·弦歌不辍(共鸣回路)',{part:2}),hit('仇远','答剑·弦歌不辍(共鸣回路)'),
  hit('仇远','答剑·割股之心(共鸣回路)'),hit('仇远','答剑·忠烈死节(共鸣回路)'),
  hit('仇远','Q',{echo:true,echoName:'无常凶鹭'}),hit('仇远','穿林打叶(共鸣技能)',{echo:true}),
  hit('仇远','终结',{damage:{[key]:1e6}}),hit('心','普攻')
 ];
 function run(seq){return simulatePreset({cycles:1,hits:seq,roles:['1311','1411','1505'],bossEventVersion:2},season,[wave(1,0,10000),wave(2,5000,1000)],0,(h,b,r)=>matrixFinalFactor(h,b,r,null));}
 const report=run(hits);
 assert.deepEqual(report.stages.map(s=>s.stacks),[5,1]);
 assert.deepEqual(report.stages[0].stackEvents.map(e=>e.hit),[2,3,4,7,8]);
 assert.ok(Math.abs(run(hits.slice(0,9)).applied-run(hits.slice(0,8)).applied-90)<1e-6);
 assert.ok(Math.abs(run(hits.slice(0,10)).applied-run(hits.slice(0,9)).applied-135)<1e-6);
});
test('named Echo casts include Cantarella and the received box; only Echo-mode Forget can repeat',()=>{
 const season=getSeason('s2-phase4'),boss=season.bosses[3],key=[1,2,3,4,5,6].map(i=>boss.resistances.values[i]).join(',');
 const make=(source,name,tags={})=>({source,name,part:1,damage:{[key]:10},...tags});
 const names=['翩跹','斑驳幻梦','感知汲取','陷溺','陷溺'];
 function run(hits,mode){return simulatePreset({cycles:1,roles:['1607','1109','1606'],hits,bossEventVersion:2},season,[wave(4,0,1e6)],0,()=>1,mode).stages[0];}
 const box=make('坎特蕾拉','珍奇箱',{castOnly:true,specialEcho:'珍奇箱',damage:{}});
 const cs=run([...names.map(n=>make('坎特蕾拉',n+'(共鸣技能)')),box]);
 assert.deepEqual(cs.stackEvents.map(e=>e.trigger),['坎特蕾拉首次输出','斑驳幻梦','感知汲取','陷溺','珍奇箱']);
 assert.equal(cs.hits,5);
 const fog=[make('洛瑟菈','遗忘(共鸣回路)',{forgetMode:'echo'}),make('洛瑟菈','遗忘(共鸣回路)',{part:2}),make('洛瑟菈','遗忘(共鸣回路)',{forgetMode:'echo'})];
 assert.equal(run(fog,'auto').stacks,3);assert.equal(run(fog,'frost').stacks,1);
});
test('S2-4 subtracts mitigation inside vulnerability and updates final damage only on the next hit',()=>{
 const matrix=getSeason('s2-phase4');
 function damageByHit(position,events){
   const boss=matrix.bosses[position-1],season={...matrix,bosses:[boss]};
   const key=[1,2,3,4,5,6].map(i=>boss.resistances.values[i]).join(',');
   // 100 base × 1.20 existing final damage × 1.25 existing vulnerability.
   const hits=events.map(tags=>({name:'测试',part:1,damage:{[key]:150},finalZone:1.2,vulnerabilityZone:1.25,...tags}));
   let previous=0;
   return hits.map((_,i)=>{
     const report=simulatePreset({cycles:1,bossEventVersion:2,hits:hits.slice(0,i+1)},season,[wave(1,0,1e5)],0,
       (hit,boss,round)=>matrixFinalFactor(hit,boss,round,null));
     const delta=report.applied-previous;previous=report.applied;return Number(delta.toFixed(5));
   });
 }
 const echoes=['a','a','b','c','d','e','e'].map(echoName=>({echo:true,echoName}));
 assert.deepEqual(damageByHit(4,echoes),[140,140,140,140,140,140,140]);
 assert.deepEqual(damageByHit(1,[{tuneBreak:true},{},{tuneBreak:true},{}]),[126,139.125,139.125,152.25]);
 assert.deepEqual(damageByHit(2,[{},{abnormal:true},{}]),[150,181.25,150]);
});
test('the response, Crownless and Echo bonuses add inside the existing final damage zone',()=>{
 const crown={id:'650000041'},other={id:'other'},c=circuitDamageRules('40');
 assert.equal(100*matrixFinalFactor({unisonRounds:1},crown,0,c),195);
 assert.ok(Math.abs(120*matrixFinalFactor({unisonRounds:1,echo:true,finalZone:1.2},crown,0,c)-280)<1e-10);
 assert.equal(matrixFinalFactor({echo:true},other,0,c),1.65);
 assert.equal(matrixFinalFactor({echo:true},other,0,circuitDamageRules('35')),1.4);
 assert.equal(matrixFinalFactor({unisonRounds:1},crown,1,c),1);
});
test('a per-hit modifier can change the finisher without amplifying the chest award or carrying overflow',()=>{
 const waves=[wave(1,0,1000,1000),wave(2,1500,5000)];
 const preset={cycles:1,hits:[shot(800,600),shot(800,600)]};
 const report=simulatePreset(preset,season,waves,0,(_hit,boss)=>boss===season.bosses[0]?1.55:1);
 assert.equal(report.kills,1);
 assert.equal(report.lost,240);
 assert.equal(report.bonuses,1000);
 assert.deepEqual(report.stages.map(s=>s.score),[1500,300]);
});
test('overkill is discarded, chest bonus once, next hit uses new resistance',()=>{
 const waves=[wave(1,0,100,1000),wave(2,1050,500)];
 const r=simulatePreset({cycles:1,hits:[shot(90,70),shot(80,60)]},season,waves,40);
 assert.equal(r.applied,80);assert.equal(r.lost,70);assert.equal(r.bonuses,1000);assert.equal(r.score,1010);assert.equal(r.end,1050);assert.deepEqual(r.stages.map(x=>x.score),[1010,0]);
});
test('exact kill changes target and scoring does not round down every hit',()=>{
 const waves=[wave(1,0,10),wave(2,5,1000)];
 const r=simulatePreset({cycles:1,hits:[shot(10,1),shot(5,301),shot(5,301)]},season,waves,0);
 assert.equal(r.kills,1);assert.equal(r.lost,0);assert.equal(r.score,306);
});
test('only the last unfinished target after a kill has a 300-point minimum',()=>{
 const waves=[wave(1,0,1000),wave(2,500,1000)];
 for(const points of [299,300]){
   const result=simulatePreset({cycles:1,hits:[shot(1000,0),shot(0,points*2)]},season,waves,0);
   assert.equal(result.end,500+(points===299?0:points));
   assert.equal(result.stages[1].uncreditedScore,points===299?299:undefined);
 }
 const first=simulatePreset({cycles:1,hits:[shot(4,0)]},season,waves,0);
 assert.equal(first.score,2);
 const completed=simulatePreset({cycles:1,hits:[shot(1000,0),shot(0,20)]},season,[waves[0],wave(2,500,20)],0);
 assert.equal(completed.score,510);
});
