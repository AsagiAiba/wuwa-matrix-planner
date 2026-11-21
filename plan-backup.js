// The cap is for UTF-8 file bytes, including whitespace in older exports.
// Quota is checked separately by committing the actual plan library.
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

export async function readPlannerJSON(file) {
  if (file.size > MAX_BACKUP_BYTES) throw Error('JSON 文件超过 32 MiB 读取上限。');
  return JSON.parse((await file.text()).replace(/^\uFEFF/,''));
}

export function checkBackupTree(value, depth = 0) {
  if (depth > 64) throw Error('排布数据嵌套过深。');
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error('排布含无效数值。');
  if (Array.isArray(value) && value.length > 10000) throw Error('排布中的数组超过允许规模。');
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) checkBackupTree(value[key],depth+1);
  }
}

// File names, whitespace and object member order are not part of JSON data.
export function sameJSON(a,b) {
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k)&&sameJSON(a[k],b[k]));
}
