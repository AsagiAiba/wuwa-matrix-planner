import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlannerJSON,MAX_BACKUP_BYTES,checkBackupTree,sameJSON} from '../plan-backup.js';

test('UTF-8 byte cap accepts the boundary and rejects the next byte before reading',async()=>{
  const exact=new Blob([' '.repeat(MAX_BACKUP_BYTES-2),'{}']);
  assert.deepEqual(await readPlannerJSON(exact),{});
  await assert.rejects(readPlannerJSON({size:MAX_BACKUP_BYTES+1,text(){assert.fail('oversized file read');}}),/32 MiB/);
  assert.deepEqual(await readPlannerJSON(new Blob(['\uFEFF{ "队伍": [] }'])),{队伍:[]});
});
test('verify entire JSON content including named plan, ordering of teams, and nested values',()=>{
  assert.ok(sameJSON({a:1,b:[2,3]},{b:[2,3],a:1}));
  assert.ok(!sameJSON({name:'A',b:[2,3]},{name:'B',b:[2,3]}));
  assert.ok(!sameJSON([2,3],[3,2]));assert.ok(!sameJSON([],{}));
  assert.throws(()=>checkBackupTree(JSON.parse('{"x":1e400}')),/数值/);
  assert.throws(()=>checkBackupTree(Array(10001).fill(0)),/规模/);
  let deep={};for(let i=0;i<65;i++)deep={a:deep};assert.throws(()=>checkBackupTree(deep),/嵌套/);
});
