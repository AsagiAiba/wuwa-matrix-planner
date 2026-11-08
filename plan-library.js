const VERSION = 1;
const MAX_PLANS = 100;

function planId(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('排布 ID 不能为空');
  return value.trim();
}

function planName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw new Error('排布名称须为 1—40 个字符');
  return value.trim();
}

function cloneConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('排布配置无效');
  return structuredClone(value);
}

function newId() {
  return globalThis.crypto.randomUUID();
}

function findPlan(library, id) {
  const plan = library.plans.find(item => item.id === planId(id));
  if (!plan) throw new Error('找不到指定排布');
  return plan;
}

function appendPlan(library, name, config, id) {
  if (library.plans.length >= MAX_PLANS) throw new Error('最多保留 100 套排布');
  const nextId = planId(id);
  if (library.plans.some(plan => plan.id === nextId)) throw new Error('排布 ID 须唯一');
  library.plans.push({ id: nextId, name: planName(name), config: cloneConfig(config) });
  library.activePlanId = nextId;
  return library;
}

/** Validate each plan independently; the callback receives and returns isolated configs. */
export function normalizePlanLibrary(value, validateConfigCallback = config => config) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('排布库格式无效');
  if (value.version !== VERSION) throw new Error('不支持的排布库版本');
  if (!Array.isArray(value.plans) || value.plans.length < 1 || value.plans.length > MAX_PLANS) throw new Error('请保留 1—100 套排布');
  if (typeof validateConfigCallback !== 'function') throw new Error('缺少排布校验函数');
  const seen = new Set();
  const plans = value.plans.map(plan => {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('排布格式无效');
    const id = planId(plan.id);
    if (seen.has(id)) throw new Error('排布 ID 须唯一');
    seen.add(id);
    const name = planName(plan.name);
    const config = cloneConfig(validateConfigCallback(cloneConfig(plan.config)));
    return { id, name, config };
  });
  const activePlanId = planId(value.activePlanId);
  if (!seen.has(activePlanId)) throw new Error('找不到当前排布');
  return { version: VERSION, activePlanId, plans };
}

/** Wrap an existing single-plan config without changing its team IDs or contents. */
export function createPlanLibrary(config, name = '我的排布', id = newId()) {
  const normalizedId = planId(id);
  return { version: VERSION, activePlanId: normalizedId, plans: [{ id: normalizedId, name: planName(name), config: cloneConfig(config) }] };
}

export function addPlan(library, name, config, id = newId()) {
  return appendPlan(normalizePlanLibrary(library), name, config, id);
}

export function copyPlan(library, sourceId, name, id = newId()) {
  const result = normalizePlanLibrary(library);
  const source = findPlan(result, sourceId);
  return appendPlan(result, name, source.config, id);
}

export function renamePlan(library, id, name) {
  const result = normalizePlanLibrary(library);
  findPlan(result, id).name = planName(name);
  return result;
}

export function updatePlan(library, id, config) {
  const result = normalizePlanLibrary(library);
  findPlan(result, id).config = cloneConfig(config);
  return result;
}

export function activatePlan(library, id) {
  const result = normalizePlanLibrary(library);
  result.activePlanId = findPlan(result, id).id;
  return result;
}

/** Delete one plan, selecting its next neighbor when the active plan is removed. */
export function deletePlan(library, id, fallbackConfig, fallbackName = '空白排布', fallbackId) {
  const result = normalizePlanLibrary(library);
  const removed = findPlan(result, id);
  const index = result.plans.findIndex(plan => plan.id === removed.id);
  if (result.plans.length === 1) {
    if (fallbackConfig === undefined) throw new Error('删除最后一套排布时需要提供空白配置');
    const nextId = planId(fallbackId === undefined ? newId() : fallbackId);
    if (nextId === removed.id) throw new Error('空白排布不能复用已删除的 ID');
    return createPlanLibrary(fallbackConfig, fallbackName, nextId);
  }
  result.plans.splice(index, 1);
  if (result.activePlanId === removed.id) result.activePlanId = result.plans[Math.min(index, result.plans.length - 1)].id;
  return result;
}
