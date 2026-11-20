const skinManifest=new URL('../data/recognition_skins.json',import.meta.url);
const size=32;
function canvasImage(image,x,y,w,h,outW,outH){
  const canvas=document.createElement('canvas');canvas.width=outW;canvas.height=outH;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(image,x,y,w,h,0,0,outW,outH);
  return ctx.getImageData(0,0,outW,outH);
}
function cardLines({data,width,height}){
  const found=[];
  function stripe(i){
    const r=data[i],g=data[i+1],b=data[i+2];
    return (r>198&&g>181&&r-b>43&&Math.abs(r-g)<45)||(b>183&&r>138&&b-r>24&&r-g>53);
  }
  for(let y=1;y<height-1;y++){
    let start=-1;
    for(let x=0;x<=width;x++){
      if(x<width&&stripe((y*width+x)*4)){if(start<0)start=x;continue;}
      if(start>=0){
        const w=x-start;
        if(w>=32&&y>=w*.90&&start>0&&x<width){
          const below=((y+1)*width+Math.floor(start+w/2))*4;
          if(data[below]<140&&data[below+1]<145&&data[below+2]<150){
            const close=found.find(c=>Math.abs(c.y-y)<w*.1&&Math.abs(c.x+c.w/2-start-w/2)<w*.3);
            if(!close)found.push({x:start,y,w});else if(w>close.w)Object.assign(close,{x:start,y,w});
          }
        }
      }
      start=-1;
    }
  }
  return found.sort((a,b)=>Math.abs(a.y-b.y)<Math.min(a.w,b.w)*.12?a.x-b.x:a.y-b.y);
}
let templatePromise;
async function loadTemplates(characters){
  const skins=await fetch(skinManifest).then(r=>r.json());
  const all=[...characters.map(c=>({id:c.id,file:c.icon_file})),...skins];
  const byFile=new Map();
  for(const v of all){
    if(!byFile.has(v.file))byFile.set(v.file,[]);
    byFile.get(v.file).push(v);
  }
  return Promise.all([...byFile].map(async ([file,variants])=>{
    const img=new Image();img.src='/'+file;await img.decode();
    return {variants,data:canvasImage(img,0,0,img.width,img.height,size,size).data};
  }));
}
function portraitError(template,card,shiftX,shiftY){
  let sum=0,n=0;
  for(let y=6;y<25;y++)for(let x=4;x<29;x++){
    if(x<12&&y<12)continue;
    const ti=((y+shiftY)*size+x+shiftX)*4,ci=(y*size+x)*4;
    if(template[ti+3]<210)continue;
    for(let k=0;k<3;k++)sum+=Math.abs(template[ti+k]-card[ci+k]);
    n++;
  }
  return n>85?sum/(3*n):Infinity;
}
function roverElement(card){
  let r=0,g=0,b=0,n=0;
  for(let y=2;y<10;y++)for(let x=2;x<10;x++){
    const i=(y*size+x)*4,v=[card[i],card[i+1],card[i+2]];
    if(Math.max(...v)-Math.min(...v)<64)continue;
    r+=v[0];g+=v[1];b+=v[2];n++;
  }
  if(!n)return null;
  if(g>r&&g>b)return 4;
  if(g>b&&r>b)return 5;
  return b>r?3:6;
}
function glyph(im,x0,y0,x1,y1){
  const result=[];const w=x1-x0+1,h=y1-y0+1;
  for(let y=0;y<18;y++)for(let x=0;x<12;x++){
    const px=x0+Math.floor((x+.5)*w/12),py=y0+Math.floor((y+.5)*h/18);
    result.push(im.data[(py*im.width+px)*4]>164?1:0);
  }
  return result;
}
function glyphs(im){
  const parts=[];let left=-1,top=im.height,bottom=-1;
  for(let x=0;x<=im.width;x++){
    let ink=false;
    if(x<im.width)for(let y=0;y<im.height;y++){
      const i=(y*im.width+x)*4;
      if(Math.min(im.data[i],im.data[i+1],im.data[i+2])>164){ink=true;top=Math.min(top,y);bottom=Math.max(bottom,y);}
    }
    if(ink){if(left<0)left=x;}
    else if(left>=0){parts.push({w:x-left,h:bottom-top+1,bits:glyph(im,left,top,x-1,bottom)});left=-1;top=im.height;bottom=-1;}
  }
  return parts;
}
let digits;
function readLevel(img,c){
  if(!digits){
    digits=[];
    for(const font of ['Arial','Segoe UI','Microsoft YaHei'])for(const weight of [500,700])for(let d=0;d<10;d++){
      const cv=document.createElement('canvas');cv.width=48;cv.height=48;const ctx=cv.getContext('2d');ctx.font=weight+' 36px "'+font+'"';ctx.fillStyle='white';ctx.fillText(String(d),5,38);
      const g=glyphs(ctx.getImageData(0,0,48,48))[0];if(g)digits.push({...g,d});
    }
  }
  const im=canvasImage(img,c.x+c.w*.45,c.y+c.w*.015,c.w*.54,c.w*.216,108,43);
  const parts=glyphs(im),dot=parts.findLastIndex(p=>p.h<10&&p.w<10);
  if(dot<0)return null;
  const numbers=parts.slice(dot+1);if(!numbers.length||numbers.length>2)return null;
  let val=0;
  for(const g of numbers){
    const ranked=digits.map(t=>({d:t.d,err:t.bits.reduce((s,v,i)=>s+Math.abs(v-g.bits[i]),0)/216+.12*Math.abs(t.w/t.h-g.w/g.h)})).sort((a,b)=>a.err-b.err);
    if(g.h<12||ranked[0].err>.32)return null;
    val=val*10+ranked[0].d;
  }
  return val>=1&&val<=90?val:null;
}
export async function recognizeRoster(blob,characters){
  const img=await createImageBitmap(blob);
  try{
    if(img.width*img.height>36e6)throw Error('图片过大，请分两次粘贴');
    const templates=await (templatePromise??=loadTemplates(characters).catch(err=>{templatePromise=null;throw err;}));
    const scale=Math.min(1,1800/Math.max(img.width,img.height));
    const resized=canvasImage(img,0,0,img.width,img.height,Math.round(img.width*scale),Math.round(img.height*scale));
    const cards=cardLines(resized),result=[];
    for(const box of cards){
      const c={x:box.x/scale,y:box.y/scale,w:box.w/scale};
      const samples=[1,.94,1.06].map(k=>canvasImage(img,c.x+(1-k)*c.w/2,c.y-c.w*k,c.w*k,c.w*k,size,size).data);
      const ranked=templates.map(t=>{
        let err=Infinity;
        for(const card of samples)for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)err=Math.min(err,portraitError(t.data,card,dx,dy));
        return {t,err};
      }).sort((a,b)=>a.err-b.err);
      const best=ranked[0],variant=best.t.variants[0],ch=characters.find(c=>c.id===variant.id);
      let id=variant.id;
      if(ch.name.startsWith('漂泊者')){
        const element=roverElement(samples[0]);id=best.t.variants.find(v=>characters.find(c=>c.id===v.id)?.element===element)?.id??null;
      }
      const preview=document.createElement('canvas');preview.width=64;preview.height=64;
      preview.getContext('2d').drawImage(img,c.x,c.y-c.w,c.w,c.w,0,0,64,64);
      result.push({id:best.err<=42&&ranked[1].err-best.err>=2?id:null,level:readLevel(img,c),skin:variant.skin??'',preview:preview.toDataURL('image/webp'),box:c});
    }
    return result;
  }finally{img.close();}
}
export function setupRosterScan({characters,choices,toChoice,preview,save,currentName}){
  const get=id=>document.getElementById(id),dialog=get('roster-scan');
  let rows=[],profiles=[],batch=0,pending=0,generation=0,queue=Promise.resolve();
  const choicesById=new Map(choices.map(c=>[c.id,c]));
  const key='wuwa-roster-profiles-v1';
  function levels(){
    return Object.fromEntries(rows.filter(r=>choicesById.has(r.id)).map(r=>[r.id,r.level??null]));
  }
  function impact(){
    const roster=levels(),count=Object.keys(roster).length,info=preview(roster);
    get('scan-impact').textContent=count?'当前排布将禁用未收录的 '+info.disabled+' 位可禁用角色。'+(info.names.length?'将删除 '+info.names.length+' 支队伍：'+info.names.join('、')+'。':''):'';
    const missing=rows.filter(r=>!choicesById.has(r.id)).length,reasons=[];
    if(missing)reasons.push('还有 '+missing+' 位角色待确认，请选择对应角色或移除该行。');
    if(pending)reasons.push('正在识别截图，请稍候。');
    if(!rows.length&&!pending)reasons.push('请粘贴截图或手动添加角色。');
    if(!get('scan-name').value.trim())reasons.push('请填写名单名称。');
    if(dialog.querySelector('input:invalid'))reasons.push('角色等级须为 1 至 90 的整数，也可以留空。');
    get('scan-validation').textContent=reasons.join(' ');
    get('scan-locate').hidden=!missing;
    get('scan-save').disabled=reasons.length>0;
  }
  function render(){
    const list=get('scan-results');list.replaceChildren();
    for(const row of rows){
      const line=document.createElement('div');line.className='scan-member';
      line.classList.toggle('unconfirmed',!choicesById.has(row.id));
      const img=document.createElement('img');img.alt='';img.src=row.preview||choicesById.get(row.id)?.icon_file||'';img.hidden=!row.preview&&!row.id;
      const who=document.createElement('select');who.ariaLabel='校正角色';who.add(new Option('待确认角色',''));
      for(const c of choices)who.add(new Option(c.name,c.id));who.value=row.id??'';
      who.onchange=()=>{
        const duplicate=rows.find(other=>other!==row&&other.id===who.value);
        if(duplicate){if(row.level!=null)duplicate.level=Math.max(row.level,duplicate.level||0);rows=rows.filter(r=>r!==row);}
        else row.id=who.value;render();
      };
      const lv=document.createElement('input');lv.type='number';lv.min=1;lv.max=90;lv.value=row.level??'';lv.placeholder='等级';lv.ariaLabel='角色等级';lv.oninput=()=>{
        row.level=lv.value&&lv.validity.valid?Number(lv.value):null;
        impact();
      };
      const remove=document.createElement('button');remove.textContent='×';remove.ariaLabel='移除该角色';remove.onclick=()=>{rows=rows.filter(r=>r!==row);render();};
      line.append(img,who,lv,remove);list.append(line);
    }
    impact();
  }
  function loadProfile(index){
    generation++;pending=0;batch=0;
    const profile=profiles[Number(index)];
    rows=index!==''&&profile?Object.entries(profile.roster).filter(([id])=>choicesById.has(id)).map(([id,level])=>({id,level})):[];
    get('scan-name').value=index!==''&&profile?profile.name:'';
    get('scan-status').textContent='';render();
  }
  get('open-roster-scan').onclick=()=>{
    try{profiles=JSON.parse(localStorage.getItem(key)||'[]');}catch{profiles=[];}
    const pick=get('scan-profiles');pick.replaceChildren(new Option('新名单',''));
    profiles.forEach((p,i)=>pick.add(new Option(p.name,String(i))));
    const index=profiles.findIndex(p=>p.name===currentName());pick.value=index<0?'':String(index);
    loadProfile(pick.value);dialog.showModal();
  };
  get('scan-profiles').onchange=e=>loadProfile(e.target.value);
  get('scan-name').oninput=impact;
  get('scan-locate').onclick=()=>get('scan-results').querySelector('.unconfirmed select')?.focus();
  get('scan-add').onclick=()=>{rows.push({id:'',level:null});render();};
  dialog.addEventListener('paste',e=>{
    const blobs=[...(e.clipboardData?.items??[])].filter(x=>x.type.startsWith('image/')).map(x=>x.getAsFile()).filter(Boolean);
    if(!blobs.length)return;e.preventDefault();
    const seq=generation;pending+=blobs.length;impact();get('scan-status').textContent='正在识别截图…';
    for(const blob of blobs)queue=queue.then(async()=>{
      if(seq!==generation)return;
      try{
        const matches=await recognizeRoster(blob,characters);
        if(seq!==generation)return;
        batch++;
        for(const match of matches){
          const id=toChoice(match.id),prior=id&&rows.find(r=>r.id===id);
          if(prior){if(match.level!=null)prior.level=Math.max(prior.level||0,match.level);}
          else rows.push({id:id||'',level:match.level,preview:match.preview});
        }
        get('scan-status').textContent='第 '+batch+' 张读到 '+matches.length+' 张角色卡，累计 '+Object.keys(levels()).length+' 位。'+(matches.length?'可继续粘贴或校正下方名单。':'请保留完整头像、底部色条和等级。');
      }catch(err){if(seq===generation)get('scan-status').textContent='识别失败：'+err.message;}
      finally{if(seq===generation){pending--;render();}}
    });
  });
  get('scan-save').onclick=()=>{
    const roster=levels(),name=get('scan-name').value.trim();
    if(!name||pending||!rows.length||rows.some(r=>!choicesById.has(r.id))||dialog.querySelector('input:invalid'))return;
    const next=profiles.filter(p=>p.name!==name).concat({name,roster});
    if(save({name,roster,storage:[key,JSON.stringify(next)]}))dialog.close();
  };
  get('close-roster-scan').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{generation++;pending=0;rows=[];get('scan-results').replaceChildren();});
}
