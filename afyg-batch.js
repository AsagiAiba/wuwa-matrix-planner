import {showCalculationOverlay} from './calculation-overlay.js';
import { refreshBundledProject, rosterKey, inspectProjectAxis, projectStages, axisLabels } from './afyg-replay/site/execution-position.js';

export async function batchEntries() {
  const library = await refreshBundledProject();
  if (library) return library.items;
  const response = await fetch('/sample.json');
  if (!response.ok) throw Error('无法读取内置工程，请重新打开后再试。');
  return [{ id: 'sample', raw: await response.json() }];
}

export function makeRosterChoices(items, previous, unavailable) {
  const remembered = new Map((Array.isArray(previous) ? previous : []).filter(p => p && typeof p.key === 'string').map(p => [p.key, p]));
  const groups = new Map();
  for (const item of items) {
    const file = item.edited ?? item.raw;
    const project = file.project ?? file;
    const key = rosterKey(project);
    if (!groups.has(key)) {
      const saved = remembered.get(key);
      groups.set(key, {key, name:project.team.map(s=>s.character).join(' · '), selected:saved?.selected !== false,
        choice:saved?.projectId ?? null, blocked:unavailable(project), entries:[]});
    }
    groups.get(key).entries.push({id:item.id, project});
  }
  for (const group of groups.values()) {
    if (group.entries.length === 1) group.choice = group.entries[0].id;
    else if (!group.entries.some(e => e.id === group.choice)) group.choice = null;
  }
  return [...groups.values()];
}

export function setupBatchProjects({currentPlan, unavailable, apply}) {
  const el = id => document.getElementById('batch-afyg' + id);
  const open = el(''), dialog = el('-dialog'), list = el('-list'), status = el('-status');
  const confirm = el('-confirm'), back = el('-back'), cancel = el('-cancel');
  let groups, planId, pickingAxes, controller;
  const selected = () => groups.filter(g => g.selected && !g.blocked);
  function controls() {
    const picked = selected();
    confirm.disabled = !picked.length || (pickingAxes && picked.some(g => !g.choice));
    confirm.textContent = !pickingAxes && picked.some(g => g.entries.length > 1) ? '下一步：选择轴' : '应用 ' + picked.length + ' 支队伍';
  }
  function option(type, title, detail) {
    const label = document.createElement('label'), input = document.createElement('input');
    const text = document.createElement('span'), note = document.createElement('small');
    input.type = type; label.className = 'batch-option';
    text.textContent = title; note.textContent = detail; text.append(note); label.append(input,text);
    return {label,input};
  }
  function draw() {
    list.replaceChildren(); status.textContent = '';
    el('-title').textContent = pickingAxes ? '为同阵容选择工程轴' : '选择要应用的队伍';
    back.hidden = !pickingAxes;
    if (!pickingAxes && groups.length) {
      const tools=document.createElement('div');
      for (const [name,value] of [['全选',true],['清空勾选',false]]) {
        const button=document.createElement('button'); button.type='button';button.textContent=name;
        button.onclick=()=>{for(const group of groups)if(!group.blocked)group.selected=value;draw();};
        tools.append(button);
      }
      list.append(tools);
    }
    for (const [i,g] of groups.entries()) {
      if (pickingAxes && (!g.selected || g.blocked || g.entries.length === 1)) continue;
      const box = document.createElement(pickingAxes?'fieldset':'div'); box.className='batch-roster';
      if (pickingAxes) {
        const legend=document.createElement('legend');legend.textContent=g.name;box.append(legend);
        for(const {id,project} of g.entries) {
          const axis=inspectProjectAxis(project,projectStages(project).timeline.data);
          const gear=project.team.map((s,j)=>s.character+' '+(s.chain??project.conditionProfile?.chains?.[j]??0)+'链 · '+(s.weapon||'未设置武器')+' '+(s.refinement??project.conditionProfile?.refinements?.[j]??1)+'精');
          const {label,input}=option('radio',project.name||'未命名工程',[axisLabels[axis.kind],...gear].join('　/　'));
          input.name='batch-axis-'+i;input.checked=g.choice===id;
          input.onchange=()=>{g.choice=id;controls();};box.append(label);
        }
      } else {
        const detail=g.entries.length===1 ? (g.entries[0].project.name||'未命名工程') : g.entries.length+' 份轴可选';
        const {label,input}=option('checkbox',g.name,g.blocked||detail);
        input.checked=g.selected&&!g.blocked;input.disabled=Boolean(g.blocked);
        input.onchange=()=>{g.selected=input.checked;controls();};box.append(label);
      }
      list.append(box);
    }
    if (!groups.length) status.textContent='工程库为空，请先导入椰果工程。';
    controls();
  }
  open.onclick=async()=>{
    open.disabled=true;
    try {
      const plan=currentPlan();
      planId=plan.id;
      groups=makeRosterChoices(await batchEntries(),plan.config.batchProjectChoices,unavailable);
      if(currentPlan().id!==planId)return;
      el('-plan').textContent='当前排布 · '+plan.name;
      pickingAxes=false;draw();dialog.showModal();
    }catch(error){el('-title').textContent='无法读取椰果工程';list.replaceChildren();status.textContent=error.message;
      confirm.disabled=true;back.hidden=true;dialog.showModal();}
    finally{open.disabled=false;}
  };
  back.onclick=()=>{pickingAxes=false;draw();};
  cancel.onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(controller)event.preventDefault();});
  dialog.addEventListener('close',()=>{controller?.abort();controller=null;list.inert=false;back.disabled=false;});
  confirm.onclick=async()=>{
    if(controller)return;
    if (!pickingAxes && selected().some(g=>g.entries.length>1)) {pickingAxes=true;draw();return;}
    const job=new AbortController();controller=job;
    confirm.disabled=true;back.disabled=true;list.inert=true;
    let unlock;
    try{
      unlock=showCalculationOverlay();
      await apply(planId,groups,job.signal,message=>{if(!job.signal.aborted)status.textContent=message;});
      if(!job.signal.aborted)dialog.close();
    }catch(error){if(!job.signal.aborted)status.textContent=error.message;}
    finally{
      unlock?.();job.abort();
      if(controller===job){controller=null;back.disabled=false;list.inert=false;controls();if(dialog.open)confirm.focus();}
    }
  };
}
