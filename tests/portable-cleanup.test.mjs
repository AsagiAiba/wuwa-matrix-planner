import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,readFile,readdir,rm,access} from 'node:fs/promises';
import {cleanupSuccessfulUpdates} from '../portable-cleanup.mjs';

test('cleanup verifies ownership, contents and success, and keeps each distinct settings backup',async t=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),'matrix-cleanup-'));
  t.after(()=>rm(parent,{recursive:true,force:true}));
  const root=path.join(parent,'portable'),backup=JSON.stringify({port:4174,version:'0.5.11',localStorage:{'wuwa-test':'saved'}});
  await mkdir(root);
  async function work(suffix,owner=root){
    const w=path.join(parent,'.matrix-update-'+suffix),prev=path.join(w,'previous');
    await mkdir(path.join(prev,'runtime'),{recursive:true});
    const files=[];
    for(const name of ['package.json','终焉矩阵血线排布.exe','runtime/node.exe','MatrixUpdate.exe']){
      const body=Buffer.from(name);await writeFile(path.join(prev,name),body);
      files.push({path:name,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')});
    }
    await writeFile(path.join(prev,'release-manifest.json'),JSON.stringify({files,fileCount:files.length,name:'终焉矩阵血线排布',platform:'win-x64',version:'0.5.11'}));
    for(const [n,data] of Object.entries({'排布备份.json':backup,'MatrixUpdate.exe':'MatrixUpdate.exe','ready':'ready','update.log':'2026-11-21T01:00:00 已启动 v0.5.12\r\n'}))await writeFile(path.join(w,n),data);
    if(owner)await writeFile(path.join(w,'install-root.txt'),owner);
    return w;
  }
  const good=await work('123abc'), legacy=await work('zyx321',null), foreign=await work('abcdef',parent);
  const altered=await work('123123'), failed=await work('456456'), pending=await work('789789');
  const custom=path.join(altered,'previous','runtime','my-notes.txt');
  await writeFile(custom,'keep');await writeFile(path.join(failed,'update.log'),'已重新启动旧版。');await mkdir(path.join(pending,'next'));
  const other=path.join(parent,'second-install');await mkdir(other);await writeFile(path.join(other,'终焉矩阵血线排布.exe'),'other');
  await cleanupSuccessfulUpdates(root,'0.5.12',4174);
  await assert.rejects(access(good),{code:'ENOENT'});await access(legacy);
  await rm(path.join(other,'终焉矩阵血线排布.exe'));
  await cleanupSuccessfulUpdates(root,'0.5.12',4174);
  await assert.rejects(access(legacy),{code:'ENOENT'});
  for(const w of [foreign,failed,pending,altered])await access(path.join(w,'previous','package.json'));
  assert.equal(await readFile(custom,'utf8'),'keep');
  const dest=path.join(parent,'排布备份'),snapshots=await readdir(dest);
  assert.equal(snapshots.length,1);
  assert.equal(await readFile(path.join(dest,snapshots[0]),'utf8'),backup);
});
