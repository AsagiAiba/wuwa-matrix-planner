export const isExecution=entry=>entry.category==='处决' && entry.name==='谐度破坏';

export function projectStages(project){
  return project.phases?.timeline?.data ? project.phases : project.encounter;
}

// Always rebuild the placements from the imported timeline. Repeated edits then
// keep native row IDs and their Buff bindings stable, including in mixed blocks.
export function repositionExecutions(current, original, moves){
  const project=structuredClone(current);
  const stages=projectStages(project);
  const source=projectStages(original);
  const timeline=structuredClone(source.timeline.data);
  stages.timeline.data=timeline;
  const anchors=new Map([...timeline.opBlocks.map(a=>[a.id,'op']),...timeline.refLines.map(a=>[a.id,'ref'])]);
  const before=[],after=[];
  const retained=[];
  const used=new Set(timeline.damageBlocks.map(b=>b.id));
  for(const block of timeline.damageBlocks){
    const move=moves[block.id];
    const executions=(block.nonDirectEntries??[]).filter(isExecution);
    if(!executions.length){retained.push(block);continue;}
    if(move?.skip===true){
      block.nonDirectEntries=block.nonDirectEntries.filter(e=>!isExecution(e));
      if(block.skillHits.length||block.nonDirectEntries.length)retained.push(block);
      continue;
    }
    if(move && (!anchors.has(move.anchorId)||!['before','after'].includes(move.side)))throw Error('处决落点无效，请重新选择');
    let moved=block;
    const others=block.nonDirectEntries.filter(e=>!isExecution(e));
    if(block.skillHits.length || others.length){
      let id=block.id+'-execution';
      while(used.has(id))id+='-x';
      used.add(id);
      for(const [field,map] of Object.entries(stages.calculation.data)){
        if(!field.startsWith('damageEntry')||!map||typeof map!=='object')continue;
        const prefix=block.id+'-nd|谐度破坏';
        const previous=id+'-nd|谐度破坏';
        for(const [key,value] of Object.entries(map)){
          if(key===previous||key.startsWith(previous+'#')){
            map[block.id+key.slice(id.length)]=value;
            delete map[key];
          }
        }
        if(move)for(const [key,value] of Object.entries(map)){
          if(key===prefix || key.startsWith(prefix+'#')){
            map[id+key.slice(block.id.length)]=value;
            delete map[key];
          }
        }
      }
      if(move){
        moved={...block,id,skillHits:[],nonDirectEntries:executions};
        block.nonDirectEntries=others;
        retained.push(block);
      }
    }
    if(!move){retained.push(block);continue;}
    moved.sourceId=move.anchorId;
    moved.sourceType=anchors.get(move.anchorId);
    (move.side==='before'?before:after).push(moved);
  }
  timeline.damageBlocks=[...before,...retained,...after];
  return project;
}

export const axisLabels={
  full:'120 秒全局轴',
  opening:'首轮特化 × 1＋循环模板 × 4',
  startup:'启动轴 × 1＋循环轴 × 3',
  single:'单轮轴 × 4（约 100 秒）'
};

export function inspectProjectAxis(project,timeline){
  const refs=[...timeline.refLines].sort((a,b)=>a.pos-b.pos);
  const label=ref=>String(ref.name||ref.time||'').trim();
  const timings=new Map((project.analysis?.timings??[]).map(t=>[t.refLineId,Number(t.seconds)]));
  const excluded=refs.find(r=>/首轮.*(?:不计|不算|排除)/.test(label(r)));
  const opening=refs.find(r=>/(?:首轮|第一轮|启动轴)/.test(label(r)) && r!==excluded);
  const loops=refs.filter(r=>/(?:循环|次轮|第二轮)/.test(label(r)));
  const title=String(project.name??'');
  const openingAndLoop=Boolean(opening && loops.some(r=>r.pos>opening.pos)) || /(?:首轮|起手)特化.*循环/.test(title);
  let finish=refs.find(r=>timings.get(r.id)===120);
  let reason=finish?'累计计时标到 120 秒':'';
  if(!finish){
    finish=refs.find(r=>/^\+?120\s*(?:s\b|秒)/i.test(label(r)));
    if(finish)reason='参考线标到 120 秒';
  }
  if(!finish && !timings.size){
    let elapsed=0;
    for(const r of refs){
      const delta=/^\+(\d+(?:\.\d+)?)\s*(?:s\b|秒)/i.exec(label(r));
      if(!delta)continue;
      elapsed+=Number(delta[1]);
      if(Math.abs(elapsed-120)<1e-6){finish=r;reason='分段参考线的时长合计 120 秒';break;}
    }
  }
  const namedFull=/120\s*(?:s|秒)|全局轴/i.test(title);
  const override=Object.hasOwn(axisLabels,project.matrixAxisType)?project.matrixAxisType:null;
  const firstLoop=loops.find(r=>opening&&r.pos>opening.pos);
  const openingSeconds=timings.get(opening?.id),loopSeconds=timings.get(firstLoop?.id)-openingSeconds;
  const threeFit=openingSeconds>0 && loopSeconds>0 && openingSeconds+3*loopSeconds<=120 && openingSeconds+4*loopSeconds>120;
  const startupMarked=/启动轴/.test(label(opening??{})+' '+title);
  const suggestedTemplate=startupMarked && (threeFit || /4\s*[r轮]/i.test(title))?'startup':'opening';
  const kind=override??(finish||(!excluded && (namedFull || (openingAndLoop && loops.length>1)))?'full':openingAndLoop?suggestedTemplate:'single');
  const start=refs.find(r=>/^\+?0\s*(?:s\b|秒)/i.test(label(r)));
  const end=start && loops.find(r=>r.pos>start.pos);
  const anchors=[...refs,...(timeline.opBlocks??[])];
  const split=anchors.find(a=>a.id===project.matrixLoopStart)??opening;
  const loopEnd=project.matrixLoopEnd==='last'?null:(anchors.find(a=>a.id===project.matrixLoopEnd)??loops.find(r=>split&&r.pos>split.pos));
  const repeats=kind==='opening'?4:kind==='startup'?3:0;
  const range=kind==='single'?{cycles:4,start:start?.pos??-Infinity,end:end?.pos??Infinity,inclusiveEnd:false}:
    {cycles:repeats+1,start:-Infinity,end:repeats?(loopEnd?.pos??Infinity):(finish?.pos??Infinity),inclusiveEnd:!repeats||!loopEnd};
  if(override)reason='按导入时选择的类型结算';
  else if(kind==='single')reason=excluded?'工程注明首轮不计，取标记内的循环段':end?'已找到单轮循环边界':'未找到完整的 120 秒计时，建议核对是否为单轮';
  else if(kind==='startup'&&threeFit)reason='启动 '+openingSeconds+' 秒，循环 '+loopSeconds+' 秒，120 秒内可打三次完整循环';
  else if(repeats)reason='参考线同时标出了首轮和循环模板';
  else if(!reason)reason=namedFull?'名称含全局轴或 120 秒，请核对结束位置':'工程已列出首轮和多段后续循环';
  if(kind==='full' && openingAndLoop)reason+='；原轴含首轮和后续循环';
  const elapsedStart=timings.get(split?.id);
  const elapsedEnd=timings.get(loopEnd?.id??'right');
  const templateSeconds=elapsedStart>0 && elapsedEnd>elapsedStart?elapsedStart+repeats*(elapsedEnd-elapsedStart):null;
  return {kind,reason,range,split,loopEnd,repeats,templateSeconds};
}

export function projectAxisRange(project,timeline){
  return inspectProjectAxis(project,timeline).range;
}

export function verifyEngineDamage(result){
  if(!Number.isFinite(result.total)||!Array.isArray(result.entries))throw Error('引擎未返回有效的总伤与逐项伤害');
  const ids=new Set();
  let sum=0;
  for(const entry of result.entries){
    if(!entry.id||ids.has(entry.id)||!Number.isFinite(entry.damage)||entry.damage<0)throw Error('引擎伤害条目重复或数值无效');
    ids.add(entry.id);sum+=entry.damage;
  }
  if(Math.abs(sum-result.total)>1e-6*Math.max(1,Math.abs(sum)))throw Error('逐项伤害之和与引擎总伤不一致');
}

export function confirmImportAxis(project){
  const t=projectStages(project)?.timeline?.data;
  if(!Array.isArray(t?.refLines)||!Array.isArray(t?.opBlocks))throw Error('工程缺少操作轴或参考线');
  const audit=inspectProjectAxis(project,t);
  const dialog=document.createElement('dialog');
  dialog.className='axis-import-dialog';
  dialog.setAttribute('aria-label','核对导入轴类型');
  dialog.innerHTML='<form method="dialog"><h2>核对导入轴类型</h2><p class="axis-import-name"></p><label>该文件包含哪种轴？<select name="kind"></select></label><p class="axis-basis"></p><div class="loop-bounds"><label>循环起点（从这一格开始）<select name="start"></select></label><label>循环结束边界（到这一格之前）<select name="end"></select></label></div><p class="axis-feedback" role="status"></p><div class="controls"><button value="cancel" type="button">取消</button><button value="ok">确认导入</button></div></form>';
  const form=dialog.querySelector('form'),{kind,start,end}=form.elements;
  dialog.querySelector('.axis-import-name').textContent=project.name||'未命名工程';
  dialog.querySelector('.axis-basis').textContent=audit.reason;
  for(const [k,v] of Object.entries(axisLabels))kind.add(new Option(v,k));
  kind.value=audit.kind;
  const anchors=[...t.refLines,...t.opBlocks].sort((a,b)=>a.pos-b.pos);
  start.add(new Option('请选择首轮与循环的分界',''));
  end.add(new Option('到工程末尾','last'));
  anchors.forEach((a,i)=>{
    const description=(i+1)+'. '+(a.key?[project.team[a.trackIndex]?.character,a.key,a.desc].filter(Boolean).join(' · '):a.name||a.time||(a.id==='left'?'起点':'结束'));
    start.add(new Option(description,a.id));end.add(new Option(description,a.id));
  });
  start.value=audit.split?.id??'';end.value=audit.loopEnd?.id??'last';
  const feedback=dialog.querySelector('.axis-feedback');
  const update=()=>{dialog.querySelector('.loop-bounds').hidden=!['opening','startup'].includes(kind.value);feedback.textContent={
    full:'从开场到结束顺序结算一次，保留已经写好的尾轮。',
    opening:'分界前只打一次，选中的循环段打四次，共五轮。',
    startup:'分界前的启动段打一次，选中的循环段打三次，共四轮。',
    single:'按单轮约 25 秒重复四次，预计覆盖 100 秒。'
  }[kind.value];};
  kind.onchange=update;update();
  form.querySelector('[value=cancel]').onclick=()=>dialog.close('cancel');
  form.onsubmit=e=>{
    if(!['opening','startup'].includes(kind.value))return;
    const boundary=anchors.find(a=>a.id===start.value)?.pos;
    const last=anchors.find(a=>a.id===end.value)?.pos??Infinity;
    const positions=new Map(anchors.map(a=>[a.id,a.pos]));
    const blocks=t.damageBlocks??[];
    if(!Number.isFinite(boundary)||!blocks.some(b=>positions.get(b.sourceId)<boundary)||!blocks.some(b=>positions.get(b.sourceId)>=boundary && positions.get(b.sourceId)<last)){
      e.preventDefault();feedback.textContent='请调整分界，让首轮和循环段各包含至少一个伤害块。';
    }
  };
  document.body.append(dialog);dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>{
    if(dialog.returnValue==='ok'){
      if(audit.kind!==kind.value)delete project.executionRounds;
      project.matrixAxisType=kind.value;
      if(['opening','startup'].includes(kind.value)){project.matrixLoopStart=start.value;project.matrixLoopEnd=end.value;}
      else {delete project.matrixLoopStart;delete project.matrixLoopEnd;}
    }
    dialog.remove();resolve(dialog.returnValue==='ok');
  },{once:true}));
}
function stableValue(value){
  return Array.isArray(value)?value.map(stableValue):value && typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])])):value;
}

// The ID "sample" belonged to the built-in slot; explicitly imported projects have independent IDs.
export async function refreshBundledProject(){
  const key='afyg-project-library-v1',text=localStorage.getItem(key);
  if(!text)return null;
  const saved=JSON.parse(text);
  if(!Array.isArray(saved?.items))throw Error('椰果工程库格式无效');
  const old=saved.items.find(item=>item.id==='sample');
  const stale=item=>item?.id==='sample' && (item.raw?.project??item.raw)?.id==='03e22bfc-fb56-4088-b1f3-f01691c01ccb';
  if(!stale(old) && !stale(saved.lastDeletion?.item))return saved;
  const response=await fetch('/sample.json',{cache:'no-store'});
  if(!response.ok)throw Error('无法读取新版内置椰果工程');
  const raw=await response.json();
  if(localStorage.getItem(key)!==text)return refreshBundledProject();
  if(stale(old)){
    const idx=saved.items.indexOf(old);
    // Keep a separately editable copy whenever the saved version differs from the original.
    if(old.edited && JSON.stringify(stableValue(old.raw))!==JSON.stringify(stableValue(old.edited))){
      saved.items.splice(idx+1,0,{...old,id:crypto.randomUUID()});
    }
    saved.items[idx]={id:'sample',raw};
  }
  if(stale(saved.lastDeletion?.item)){
    saved.lastDeletion.item.id=crypto.randomUUID();
    if(!saved.items.some(item=>item.id==='sample')){
      saved.items.push({id:'sample',raw});
      saved.activeId??='sample';
    }
  }
  localStorage.setItem(key,JSON.stringify(saved));
  return saved;
}
