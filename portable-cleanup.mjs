import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile, lstat, mkdir, readdir, readFile, realpath, rmdir, unlink, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';

const folderPattern = /^\.matrix-update-[a-zA-Z0-9]{6}$/;
const versionPattern = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const manifestName = 'release-manifest.json';
const backupName = '排布备份.json';
const ownerName = 'install-root.txt';
const receiptName = 'cleanup.json';
const norm = p => path.resolve(p).toLowerCase();

async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

function compare(a,b) {
  const v=a.split('.').map(Number), w=b.split('.').map(Number);
  return v[0]-w[0] || v[1]-w[1] || v[2]-w[2];
}

async function regular(file,directory=false) {
  const s=await lstat(file);
  if(s.isSymbolicLink() || !(directory?s.isDirectory():s.isFile()) || norm(await realpath(file))!==norm(file))
    throw Error('更新目录包含链接或非普通文件');
  return s;
}

async function optionalText(file) {
  try { await regular(file); return await readFile(file,'utf8'); }
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}

// Walk the actual tree. Only return files whose size and digest match the
// shipped manifest. Never recursively remove unknown files inside a portable install.
async function oldProgram(previous,from,resuming) {
  await regular(previous,true);
  const manifestText=await optionalText(path.join(previous,manifestName));
  if(!manifestText){
    if(resuming && !(await readdir(previous)).length)return [[],[previous]];
    throw Error('缺少旧版清单');
  }
  const manifest=JSON.parse(manifestText.replace(/^\uFEFF/,''));
  if(manifest.name!=='终焉矩阵血线排布' || manifest.version!==from ||
     manifest.platform!=='win-x64' || !Array.isArray(manifest.files) || manifest.fileCount!==manifest.files.length)
    throw Error('旧版清单不匹配');
  const expected=new Map(manifest.files.map(f=>[f.path,f]));
  for(const required of ['package.json','终焉矩阵血线排布.exe','runtime/node.exe','MatrixUpdate.exe'])
    if(!expected.has(required))throw Error('旧版清单不完整');
  const parents=new Set();
  for(const name of expected.keys()){
    if(typeof name!=='string'||name.includes('\\')||name.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('清单路径无效');
    for(let i=name.indexOf('/');i>=0;i=name.indexOf('/',i+1))parents.add(name.slice(0,i));
  }
  const files=[],dirs=[];
  async function visit(dir){
    for(const e of await readdir(dir,{withFileTypes:true})){
      const file=path.join(dir,e.name),name=path.relative(previous,file).split(path.sep).join('/');
      if(name===manifestName)continue;
      if(e.isDirectory() && parents.has(name)){await regular(file,true);await visit(file);continue;}
      const item=expected.get(name);
      if(!item || (await regular(file)).size!==item.bytes || await hash(file)!==item.sha256)throw Error('旧程序里有额外文件或改过的文件');
      files.push(file);
    }
    dirs.push(dir);
  }
  await visit(previous);
  if(!resuming && files.length!==expected.size)throw Error('旧版文件数不符');
  return [files,dirs];
}

async function cleanOne(parent,name,root,version,port,legacyOK,alias) {
  const work=path.join(parent,name);
  await regular(work,true);
  const entries=await readdir(work);
  const owner=await optionalText(path.join(work,ownerName));
  if(owner!==null ? norm(owner)!==norm(root) && norm(owner)!==alias : !legacyOK)return;
  if(entries.some(n=>!['previous','update.log','ready','MatrixUpdate.exe',backupName,ownerName,receiptName].includes(n)))return;
  const receipt=await optionalText(path.join(work,receiptName));
  const backupDir=path.join(parent,'排布备份');
  let record;
  if(receipt){
    record=JSON.parse(receipt);
    if(record.root!==norm(root)||record.port!==port||!versionPattern.test(record.from)||!versionPattern.test(record.to)||
       compare(record.from,record.to)>=0 || compare(record.to,version)>0)return;
    if(!/^[0-9a-f]{64}$/.test(record.backupHash))return;
  }else{
    if(!['previous',backupName,'update.log','ready','MatrixUpdate.exe'].every(n=>entries.includes(n)))return;
    const log=await optionalText(path.join(work,'update.log'));
    const success=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d 已启动 v(\d{1,6}\.\d{1,6}\.\d{1,6})$/.exec(log?.trimEnd().split(/\r?\n/).at(-1));
    if(!success || compare(success[1],version)>0 || (await optionalText(path.join(work,'ready')))!=='ready')return;
    const backup=path.join(work,backupName);
    if((await regular(backup)).size>32*1024*1024+1024)return;
    const data=JSON.parse(await readFile(backup,'utf8'));
    if(!versionPattern.test(data.version)||compare(data.version,success[1])>=0 || data.port!==port ||
       !data.localStorage || typeof data.localStorage!=='object' || Array.isArray(data.localStorage))return;
    record={root:norm(root),port,from:data.version,to:success[1],backupHash:await hash(backup)};
  }
  const destination=path.join(backupDir,'v'+record.from+'-'+port+'-'+record.backupHash.slice(0,12)+'.json');
  if(receipt){
    await regular(backupDir,true);await regular(destination);
    if(await hash(destination)!==record.backupHash)return;
    if(entries.includes(backupName)){
      await regular(path.join(work,backupName));
      if(await hash(path.join(work,backupName))!==record.backupHash)return;
    }
  }
  const previous=path.join(work,'previous');
  const [files,dirs]=entries.includes('previous')?await oldProgram(previous,record.from,Boolean(receipt)):[[],[]];
  if(!receipt){
    await regular(path.join(work,'MatrixUpdate.exe'));
    if(await hash(path.join(work,'MatrixUpdate.exe'))!==await hash(path.join(previous,'MatrixUpdate.exe')))return;
    await mkdir(backupDir,{recursive:true});await regular(backupDir,true);
    try {await copyFile(path.join(work,backupName),destination,constants.COPYFILE_EXCL);}
    catch(error){if(error.code!=='EEXIST')throw error;}
    await regular(destination);
    if(await hash(destination)!==record.backupHash)throw Error('排布备份校验失败');
    await writeFile(path.join(work,receiptName),JSON.stringify(record),{flag:'wx'});
  }
  // Remove the helper first: Windows keeps it locked until Apply has exited.
  const remove=async n=>{if(entries.includes(n)){const f=path.join(work,n);await regular(f);await unlink(f);}};
  await remove('MatrixUpdate.exe');
  for(const file of files)await unlink(file);
  for(const dir of dirs){
    if(dir===previous){
      // Retain the manifest until all nested files and directories are gone:
      // a locked directory or interrupted cleanup can then be retried.
      const remaining=await readdir(dir);
      if(remaining.length===1 && remaining[0]===manifestName)await unlink(path.join(dir,manifestName));
    }
    await rmdir(dir);
  }
  for(const n of [backupName,'ready','update.log',ownerName])await remove(n);
  await unlink(path.join(work,receiptName));
  await rmdir(work);
}

export async function cleanupSuccessfulUpdates(root,version,port) {
  // Accept Windows 8.3 spellings, but do not follow a linked installation.
  const alias=norm(root);
  for(let p=path.resolve(root);;p=path.dirname(p)){
    if((await lstat(p)).isSymbolicLink())return;
    if(path.dirname(p)===p)break;
  }
  root=await realpath(root);
  await regular(root,true);
  const parent=path.dirname(root),siblings=await readdir(parent,{withFileTypes:true});
  // Older helpers did not record their installation path. Leave their backups
  // alone if more than one portable installation shares the parent.
  let legacyOK=true;
  for(const entry of siblings){
    if(!entry.isDirectory()||norm(path.join(parent,entry.name))===norm(root))continue;
    try{await lstat(path.join(parent,entry.name,'终焉矩阵血线排布.exe'));legacyOK=false;break;}
    catch(error){if(error.code!=='ENOENT')legacyOK=false;}
  }
  for(const e of siblings){
    if(!e.isDirectory()||!folderPattern.test(e.name))continue;
    try{await cleanOne(parent,e.name,root,version,port,legacyOK,alias);}
    catch(error){console.warn('更新目录稍后再处理：',e.name,error.message);}
  }
}
