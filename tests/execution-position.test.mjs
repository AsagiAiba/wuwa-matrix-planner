import test from 'node:test';
import assert from 'node:assert/strict';
import {repositionExecutions,inspectProjectAxis,verifyEngineDamage} from '../afyg-replay/site/execution-position.js';

test('a written 120s opening and loop timeline plays once; a selected template plays 1 + 4',()=>{
  const t={refLines:[{id:'a',time:'+26s 首轮',pos:10},{id:'b',time:'+25s 循环轴',pos:20},{id:'z',time:'结束',pos:50}]};
  assert.equal(inspectProjectAxis({},t).kind,'opening');
  const full={analysis:{timings:[{refLineId:'z',seconds:120}]}};
  assert.equal(inspectProjectAxis(full,t).range.cycles,1);
  const chosen=inspectProjectAxis({...full,matrixAxisType:'opening',matrixLoopStart:'a',matrixLoopEnd:'b'},t);
  assert.equal(chosen.range.cycles,5);assert.equal(chosen.split.pos,10);assert.equal(chosen.range.end,20);
  assert.equal(chosen.range.inclusiveEnd,false);
});
test('an inconsistent native damage result or duplicated entry cannot pass import verification',()=>{
  verifyEngineDamage({total:12,entries:[{id:'A',damage:2},{id:'B',damage:10}]});
  assert.throws(()=>verifyEngineDamage({total:20,entries:[{id:'A',damage:2}]}));
  assert.throws(()=>verifyEngineDamage({total:4,entries:[{id:'A',damage:2},{id:'A',damage:2}]}));
});
test('startup ends at 30s and its 28s loop plays three times, preserving other choices',()=>{
  const t={refLines:[{id:'a',time:'启动轴',pos:2812},{id:'b',time:'循环轴',pos:5333},{id:'right',time:'结束',pos:10848}]};
  const project={analysis:{timings:[{refLineId:'b',seconds:58},{refLineId:'a',seconds:30}]}};
  const audit=inspectProjectAxis(project,t);
  assert.equal(audit.kind,'startup');assert.equal(audit.repeats,3);assert.equal(audit.range.cycles,4);
  assert.equal(audit.split.id,'a');assert.equal(audit.range.end,5333);
  assert.equal(audit.range.inclusiveEnd,false);assert.equal(audit.templateSeconds,114);
  assert.equal(inspectProjectAxis({...project,matrixAxisType:'opening'},t).range.cycles,5);
  assert.equal(inspectProjectAxis({...project,matrixAxisType:'single'},t).repeats,0);
  project.analysis.timings.push({refLineId:'right',seconds:120});
  assert.equal(inspectProjectAxis(project,t).kind,'full');
});

test('move separate executions without moving co-bound skills, effects or losing row bindings',()=>{
  const execution={name:'谐度破坏',category:'处决',responders:['心']};
  const effect={name:'电磁效应',category:'效应'};
  const original={phases:{
    timeline:{data:{opBlocks:[{id:'A',pos:10},{id:'B',pos:20}],refLines:[],damageBlocks:[
      {id:'d1',sourceId:'A',sourceType:'op',skillHits:[{hitName:'普攻'}],nonDirectEntries:[execution,effect]},
      {id:'d2',sourceId:'B',sourceType:'op',skillHits:[],nonDirectEntries:[execution]}
    ]}},
    calculation:{data:{damageEntryBuffSetIds:{'d1-nd|谐度破坏':['a'],'d1-nd|电磁效应':['b']}}}
  }};
  const moves={d1:{anchorId:'B',side:'after'},d2:{anchorId:'A',side:'before'}};
  const revised=repositionExecutions(original,original,moves);
  const [first,mixed,last]=revised.phases.timeline.data.damageBlocks;
  assert.deepEqual([first.sourceId,mixed.sourceId,last.sourceId],['A','A','B']);
  assert.deepEqual(mixed.nonDirectEntries,[effect]);
  assert.deepEqual(last.nonDirectEntries,[execution]);
  assert.deepEqual(revised.phases.calculation.data.damageEntryBuffSetIds[last.id+'-nd|谐度破坏'],['a']);
  assert.deepEqual(repositionExecutions(revised,original,moves),revised);
  assert.deepEqual(repositionExecutions(revised,original,{}),original);
  const skipped=repositionExecutions(original,original,{d1:{skip:true},d2:{skip:true}});
  const blocks=skipped.phases.timeline.data.damageBlocks;
  assert.equal(blocks.length,1);
  assert.deepEqual(blocks[0].skillHits,[{hitName:'普攻'}]);
  assert.deepEqual(blocks[0].nonDirectEntries,[effect]);
});
