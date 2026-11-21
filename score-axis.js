export function parseScoreInput(input) {
  const text = String(input ?? '').trim();
  if (!text || text.length > 100) return NaN;
  const leadingSign = /^[+-]/.test(text) ? text[0] : '';
  const parts = text.slice(leadingSign.length).split(/(?<![eE])([+-])/);
  let total = 0n, scale = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const match = /^(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?\s*([kwm]?)$/i.exec(parts[i].trim());
    if (!match) return NaN;
    const [whole, fraction = ''] = match[1].split('.');
    const digits = BigInt((whole || '0') + fraction);
    const shift = Number(match[2] || 0) + ({ k: 3, w: 4, m: 6 }[match[3].toLowerCase()] || 0) - fraction.length;
    if (!Number.isSafeInteger(shift) || Math.abs(shift) > 1000) return NaN;
    const value = Number(digits + 'e' + shift);
    if (!Number.isFinite(value) || (value === 0 && digits !== 0n)) return NaN;
    // Add on a common decimal scale to keep expressions such as 0.3-0.2 exact.
    const nextScale = Math.min(scale, shift);
    const signed = (i ? parts[i-1] : leadingSign) === '-' ? -digits : digits;
    total = total * 10n ** BigInt(scale - nextScale) + signed * 10n ** BigInt(shift - nextScale);
    scale = nextScale;
  }
  const result = Number(total + 'e' + scale);
  return Number.isFinite(result) && (result !== 0 || total === 0n) ? result : NaN;
}

export function visibleWaves(records, maxRound) {
  return records.filter(wave => wave.round <= maxRound);
}

export function bossScoreAtRemainingHp(wave, remainingPercent) {
  if (!Number.isFinite(remainingPercent) || remainingPercent < 0 || remainingPercent > 100) throw new RangeError('剩余血量百分比须为 0—100');
  if (!Number.isFinite(wave?.damage_points_at_full_hp) || !Number.isFinite(wave.full_kill_points) || !Number.isFinite(wave.kill_bonus) || wave.damage_points_at_full_hp <= 0 || wave.kill_bonus < 0 || wave.full_kill_points < wave.damage_points_at_full_hp) throw new TypeError('Boss 分数数据无效');
  const damagePointsEarned = wave.damage_points_at_full_hp * (1 - remainingPercent / 100);
  const killBonusEarned = remainingPercent === 0 ? wave.kill_bonus : 0;
  const earnedPoints = remainingPercent === 0 ? wave.full_kill_points : damagePointsEarned;
  return { earnedPoints, remainingPoints: wave.full_kill_points - earnedPoints, damagePointsEarned, killBonusEarned };
}

export function locateScore(score, waves) {
  if (!Number.isFinite(score) || !waves.length || score < 0 || score > waves.at(-1).cumulative_points_after + 1e-7) throw new RangeError('积分超出当前血线轴');
  const wave = waves.find(item => score < item.cumulative_points_after - 1e-7) || waves.at(-1);
  const within = Math.max(0, score - wave.cumulative_points_before);
  const damage = Math.min(within, wave.damage_points_at_full_hp);
  const inBonus = wave.kill_bonus > 0 && within >= wave.damage_points_at_full_hp - 1e-7 && within < wave.full_kill_points - 1e-7;
  const completed = score >= waves.at(-1).cumulative_points_after - 1e-7;
  const remainingHp = inBonus || completed ? 0 : Math.max(0, 1 - damage / wave.damage_points_at_full_hp);
  const remainingPoints = completed ? 0 : Math.max(0, wave.cumulative_points_after - score);
  return { wave, remainingHp, remainingPoints, inBonus, completed };
}

export function packTeams(teams) {
  let cursor = 0;
  return teams.map(team => {
    const packed = { ...team, startScore: cursor };
    cursor += team.score;
    return packed;
  });
}

export const PENDING_TEAM_SCORE = 5000;

export function layoutTeamPreviews(teams) {
  let cursor = 0;
  let pendingBefore = false;
  return teams.map(team => {
    const pending = team.needsScore === true;
    const axisScore = pending ? PENDING_TEAM_SCORE : team.score;
    const preview = {
      ...structuredClone(team),
      axisScore,
      axisStartScore: cursor,
      positionIsPreview: pendingBefore || pending,
    };
    cursor += axisScore;
    pendingBefore ||= pending;
    return preview;
  });
}

const TEAM_DELETION_HISTORY_LIMIT = 2;

export function createTeamDeletionHistory() {
  return { undo: [], redo: [] };
}

function copyTeamDeletionInputs(teams, history) {
  if (!Array.isArray(teams) || !history || !Array.isArray(history.undo) || !Array.isArray(history.redo)) throw new Error('队伍删除记录无效');
  const ids = new Set();
  for (const team of teams) {
    if (!team || typeof team.id !== 'string' || !team.id || ids.has(team.id)) throw new Error('队伍 ID 无效或重复');
    ids.add(team.id);
  }
  for (const stack of [history.undo, history.redo]) {
    if (stack.length > TEAM_DELETION_HISTORY_LIMIT) throw new Error('队伍删除记录超出两次上限');
    for (const record of stack) {
      if (!record?.team || typeof record.team.id !== 'string' || !record.team.id || !Number.isInteger(record.index) || record.index < 0
          || ![record.beforeId, record.afterId].every(id => id === null || (typeof id === 'string' && id.length > 0 && id !== record.team.id))) throw new Error('队伍删除记录无效');
    }
  }
  return { teams: structuredClone(teams), history: structuredClone(history) };
}

function teamDeletionRecord(teams, index) {
  return {
    team: structuredClone(teams[index]), index,
    beforeId: teams[index - 1]?.id ?? null,
    afterId: teams[index + 1]?.id ?? null,
  };
}

function appendTeamDeletionRecord(stack, record) {
  return [...stack, record].slice(-TEAM_DELETION_HISTORY_LIMIT);
}

export function deleteTeamWithHistory(teams, id, history = createTeamDeletionHistory()) {
  const next = copyTeamDeletionInputs(teams, history);
  const index = next.teams.findIndex(team => team.id === id);
  if (index < 0) throw new Error('找不到要删除的队伍');
  const record = teamDeletionRecord(next.teams, index);
  next.teams.splice(index, 1);
  return { teams: packTeams(next.teams), history: { undo: appendTeamDeletionRecord(next.history.undo, record), redo: [] } };
}

export function undoTeamDeletion(teams, history) {
  const next = copyTeamDeletionInputs(teams, history);
  const record = next.history.undo.pop();
  if (!record) throw new Error('没有可以撤回的队伍删除');
  if (next.teams.some(team => team.id === record.team.id)) throw new Error('无法撤回删除：该队伍 ID 已存在');
  const before = next.teams.findIndex(team => team.id === record.beforeId);
  const after = next.teams.findIndex(team => team.id === record.afterId);
  const anchorsReversed = before >= 0 && after >= 0 && before >= after;
  const index = anchorsReversed ? Math.min(record.index, next.teams.length) : after >= 0 ? after : before >= 0 ? before + 1 : Math.min(record.index, next.teams.length);
  next.teams.splice(index, 0, structuredClone(record.team));
  return { teams: packTeams(next.teams), history: { undo: next.history.undo, redo: appendTeamDeletionRecord(next.history.redo, record) } };
}

export function redoTeamDeletion(teams, history) {
  const next = copyTeamDeletionInputs(teams, history);
  const record = next.history.redo.pop();
  if (!record) throw new Error('没有可以恢复的队伍删除');
  const index = next.teams.findIndex(team => team.id === record.team.id);
  if (index < 0) throw new Error('无法恢复删除：对应队伍已不存在');
  const current = teamDeletionRecord(next.teams, index);
  next.teams.splice(index, 1);
  return { teams: packTeams(next.teams), history: { undo: appendTeamDeletionRecord(next.history.undo, current), redo: next.history.redo } };
}

export function reorderTeams(teams, id, targetIndex) {
  const ordered = [...teams];
  const index = ordered.findIndex(team => team.id === id);
  if (index < 0) return packTeams(ordered);
  const [team] = ordered.splice(index, 1);
  ordered.splice(Math.max(0, Math.min(ordered.length, targetIndex)), 0, team);
  return packTeams(ordered);
}

export function nearestTeamSlot(teams, id, desiredStart) {
  const others = teams.filter(team => team.id !== id);
  const starts = [0];
  for (const team of others) starts.push(starts.at(-1) + team.score);
  let best = 0;
  for (let index = 1; index < starts.length; index++) {
    if (Math.abs(starts[index] - desiredStart) < Math.abs(starts[best] - desiredStart)) best = index;
  }
  return best;
}

export function characterIdentity(character) {
  return character.name.startsWith('漂泊者') ? '漂泊者' : character.id;
}

export function defaultTeamName(characterIds, characterMap) {
  return characterIds.map(id => [...(characterMap.get(id)?.name || '')][0] || '').join('');
}

export function splitQuickTeams(sequence) {
  const groups = [];
  for (let index = 0; index < sequence.length; index += 3) groups.push(sequence.slice(index, index + 3));
  return groups;
}

export function axisTickStep(pixelsPerPoint) {
  const desired = 80 / pixelsPerPoint;
  const magnitude = 10 ** Math.floor(Math.log10(desired));
  return [1, 2, 5, 10].find(step => step * magnitude >= desired) * magnitude;
}

export function staminaLimits(rules, seasonId, identityById = new Map()) {
  const limits = new Map();
  if (!rules) return limits;
  const season = rules.seasons.find(item => item.id === (seasonId || rules.defaultSeason));
  if (!season) throw new Error('体力期数无效');
  const baseStamina = season.baseStamina || rules.baseStamina;
  const defaultStamina = season.defaultStamina || rules.defaultStamina;
  for (const identity of identityById.values()) limits.set(identity, defaultStamina);
  for (const [id, count] of Object.entries(baseStamina)) {
    const identity = identityById.get(id) || id;
    limits.set(identity, count);
  }
  for (const id of season.bonusCharacterIds) {
    const identity = identityById.get(id) || id;
    limits.set(identity, (limits.get(identity) || defaultStamina) + season.extraStamina);
  }
  return limits;
}

export function staminaConflicts(teams, rules, seasonId, identityById = new Map()) {
  const limits = staminaLimits(rules, seasonId, identityById);
  const usage = new Map();
  teams.forEach((team, index) => {
    const seen = new Set();
    for (const id of team.characterIds) {
      const identity = identityById.get(id) || id;
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (!usage.has(identity)) usage.set(identity, { identity, characterId: id, teams: [] });
      usage.get(identity).teams.push({ id: team.id, name: team.name, number: index + 1 });
    }
  });
  return [...usage.values()].map(item => {
    const limit = limits.get(item.identity) || rules?.defaultStamina || 1;
    return { ...item, used: item.teams.length, limit, excess: item.teams.length - limit };
  }).filter(item => item.excess > 0);
}

export function matrixInfo(config) {
  const season = getSeason(config);
  return { id: season.id, towerId: season.towerId, name: season.name, scoreReady: season.scoring.waves.length > 0, provisional: season.scoring.status === 'provisional', maxRound: season.maxRound };
}

export function validateConfig(value, characterIds, records, identityById = new Map(), staminaRules, options = {}) {
  if (!value || value.version !== 1) throw new Error('请导入 version: 1 JSON 配置');
  const matrix = matrixInfo(value);
  const maxRound = Math.max(...records.map(wave => wave.round));
  if (!Number.isInteger(value.maxRound) || value.maxRound < 1) throw new Error(`显示轮次须为 1—${maxRound}`);
  if (!Number.isFinite(value.pixelsPerPoint) || value.pixelsPerPoint <= 0 || value.pixelsPerPoint > MAX_ZOOM) throw new Error('缩放范围无效');
  if (!Array.isArray(value.teams) || value.teams.length > 40) throw new Error('队伍数量须为 0—40');
  if (value.disabledCharacterIds !== undefined && (!Array.isArray(value.disabledCharacterIds) || value.disabledCharacterIds.some(id => typeof id !== 'string' || !characterIds.has(id)) || new Set(value.disabledCharacterIds).size !== value.disabledCharacterIds.length)) throw new Error('禁用角色配置无效');
  if (value.scoreMarker != null && (!Number.isFinite(value.scoreMarker) || value.scoreMarker < 0 || value.scoreMarker > (matrix.scoreReady ? records.at(-1).cumulative_points_after : Number.MAX_SAFE_INTEGER))) throw new Error('目标总分标记超出已导入的分数范围');
  const total = matrix.scoreReady ? visibleWaves(records, Math.min(value.maxRound, maxRound)).at(-1).cumulative_points_after : Number.MAX_SAFE_INTEGER;
  const ids = new Set();
  const usedCharacters = new Map();
  const staminaSeason = value.staminaSeason || matrix.id;
  const limits = staminaLimits(staminaRules, staminaSeason, identityById);
  let combinedScore = 0;
  for (const team of value.teams) {
    if (typeof team.id !== 'string' || !team.id || ids.has(team.id)) throw new Error('队伍 ID 须唯一');
    ids.add(team.id);
    if (typeof team.name !== 'string' || !team.name.trim() || team.name.length > 30) throw new Error('队名须为 1—30 个字符');
    if (team.nameMode !== undefined && !['auto', 'custom'].includes(team.nameMode)) throw new Error('队名模式无效');
    const roster = team.characterIds;
    if (!Array.isArray(roster) || (roster.length !== 3 && !(team.needsCharacters === true && roster.length < 3)) || new Set(roster).size !== roster.length || roster.some(id => !characterIds.has(id))) throw new Error('每队需选择 3 个不同的有效角色');
    const teamIdentities = new Set();
    for (const id of roster) {
      const identity = identityById.get(id) || id;
      if (teamIdentities.has(identity)) throw new Error('同一队内不能重复选择同一角色');
      teamIdentities.add(identity);
      const count = (usedCharacters.get(identity) || 0) + 1;
      if (!options.allowStaminaConflicts && count > (limits.get(identity) || staminaRules?.defaultStamina || 1)) throw new Error('角色体力不足，不能重复上阵到更多队伍');
      usedCharacters.set(identity, count);
    }
    if (Object.hasOwn(team, 'needsScore') && typeof team.needsScore !== 'boolean') throw new Error('待填分数标记须为布尔值');
    if (team.needsScore === true && team.score !== 0) throw new Error('待填分数的队伍分数须为 0');
    const awaitingScore = team.needsScore === true && team.score === 0;
    if (!Number.isFinite(team.score) || team.score < 0 || (!awaitingScore && team.score === 0) || team.score > total || !Number.isFinite(team.startScore) || team.startScore < 0 || team.startScore + team.score > total + 1e-7) throw new Error('队伍分数或起点超出当前血线轴');
    if (!/^#[\da-f]{6}$/i.test(team.color)) throw new Error('队伍颜色格式无效');
    combinedScore += team.score;
  }
  if (combinedScore > total + 1e-7) throw new Error('所有队伍的总分超出当前血线轴，请增加显示轮次');
  const normalized = structuredClone(value);
  normalized.maxRound = Math.min(normalized.maxRound, maxRound);
  normalized.matrixSeason = matrix.id;
  normalized.matrixVersion = matrix.name;
  normalized.pixelsPerPoint = Math.max(MIN_ZOOM, normalized.pixelsPerPoint);
  if (staminaRules) normalized.staminaSeason = staminaSeason;
  normalized.teams = packTeams(normalized.teams);
  if (matrix.scoreReady && normalized.scoreMarker != null) normalized.maxRound = Math.max(normalized.maxRound, records.find(wave => wave.cumulative_points_after >= normalized.scoreMarker).round);
  return normalized;
}
export const MIN_ZOOM = 0.000001;
export const MAX_ZOOM = 0.24;

import { getSeason,damageProfileKey } from './season-config.js';
import matrixDamageRules from './config/matrix_damage_rules.json' with {type:'json'};
import characters from './data/characters.json' with {type:'json'};
import {specialEchoCast} from './cingulum.js';
const roleNames=new Map(characters.entries.map(c=>[c.id,c.name]));

export function circuitDamageRules(id){
  return matrixDamageRules.circuits[id]??null;
}

export function matrixFinalFactor(hit,boss,round,circuit,applicationActive=false){
  const responding=Boolean((hit.unisonRounds??0)&(1<<round));
  let extra=circuit?.all??0;
  if(responding)extra+=(circuit?.unison??0)+(matrixDamageRules.bosses[boss.id]?.unison??0);
  if(hit.echo)extra+=circuit?.echo??0;
  if(hit.basic)extra+=circuit?.basic??0;
  if(hit.liberation)extra+=circuit?.liberation??0;
  if(applicationActive)extra+=circuit?.afterApplication??0;
  if(hit.glacioLayers>0 || hit.glacioDamage)extra+=circuit?.glacioDamage??0;
  const existing=hit.finalZone??1;
  return existing>0?1+extra/(100*existing):1;
}

function recordStack(hit,stage,rule,round,roster,mode){
  if(stage.stacks>=rule.maxStacks)return;
  function add(key,trigger,repeat=false){
    if(stage.stacks>=rule.maxStacks||(!repeat && stage.stackEvents.some(e=>e.key===key)))return;
    stage.stacks++;
    stage.stackEvents.push({key,hit:stage.hits+(hit.castOnly?0:1),round:round+1,trigger,stacks:stage.stacks,castOnly:!!hit.castOnly});
  }
  if(rule.tuneBreak && (hit.tuneBreak || hit.name==='谐度破坏') && hit.part===1){
    add('break','谐度破坏',true);
  }else if(rule.echo){
    if(!hit.castOnly && !hit.offField && roster.has(hit.source))add('role:'+hit.source,hit.source+'首次输出');
    const cast=hit.specialEcho??(hit.part===1?specialEchoCast(hit.source,hit.name,roster.has('洛可可')):undefined);
    if(!cast||!roster.has(cast==='珍奇箱'?'洛可可':hit.source))return;
    if(cast==='遗忘' && (mode==='echo'||(mode==='auto'&&hit.forgetMode==='echo')))add(cast,'遗忘',true);
    else if(cast!=='遗忘')add('cast:'+cast,cast);
  }
}

// A cycle is ordered by the project's operation/reference positions. Each row
// below is one independent hit, including repeats inside a single action.
export function simulatePreset(preset, season, waves, start, damageFactor, forgetMode='auto', circuit=null) {
  let index = waves.findIndex(wave => start < wave.cumulative_points_after - 1e-7);
  if (index < 0) return { reason: '起点已到血线末端' };
  const opening = waves[index];
  if(opening.enemy_level && preset.matrixLevelVersion!==1)return {reason:'此旧预设缺少按轮次计算的等级与防御，请在椰果工程中选中原工程并重新应用。'};
  const offset = Math.max(0, start - opening.cumulative_points_before);
  if (opening.kill_bonus && offset >= opening.damage_points_at_full_hp)
    return { reason: '起点位于宝箱击杀奖励区，请调整前队分数' };
  const keys = season.bosses.map(boss => [1,2,3,4,5,6].map(id => boss.resistances.values[id]).join(','));
  // Invert partial scores using the same per-damage coefficient used below.
  let hp = opening.max_hp - offset / opening.points_per_damage;
  let end = start, applied = 0, lost = 0, bonuses = 0, kills = 0, count = 0;
  const stages = [];
  const roster=new Set((preset.roles??[]).map(id=>roleNames.get(id)));
  const timedCircuit=season.id==='s2-phase4' && circuit?.applicationSeconds;
  if(timedCircuit && (!Array.isArray(preset.roundSeconds)||preset.roundSeconds.length!==preset.cycles))
    return {reason:'请重新应用椰果工程以载入异常附加事件和计时。'};
  let roundStart=0;
  for (let round = 0; round < preset.cycles; round++) {
    const hits=preset.roundOrders ? preset.roundOrders[round].map(i=>preset.hits[i]) : preset.hits;
    for (const hit of hits) {
      if (index === waves.length) break;
      const wave = waves[index];
      const boss=season.bosses[wave.boss_position-1];
      const rule=damageFactor && preset.bossEventVersion===2 && season.id==='s2-phase4'?matrixDamageRules.s2Phase4Bosses[boss.id]:null;
      const statusOnly=hit.castOnly && hit.statusApplication;
      if(hit.castOnly && !rule?.echo && !(timedCircuit&&statusOnly))continue;
      const profile=damageProfileKey(wave.enemy_level??100,keys[wave.boss_position-1]);
      const baseDamage = hit.castOnly?0:hit.damage[profile];
      if (!Number.isFinite(baseDamage)) return { reason: '此预设缺少当前 Boss 的等级和抗性组合，请重新应用椰果工程。' };
      if (stages.at(-1)?.index !== index){
        const next={index, name: 'R'+wave.round+' '+wave.name, score:0, lost:0, hits:0};
        if(rule?.maxStacks)Object.assign(next,{stacks:0,stackLabel:rule.echo?'迷航':'谐度破坏',stackEvents:[]});
        if(rule?.hiyukiTeamFinal && roster.has('绯雪'))next.hiyukiTeamFinal=rule.hiyukiTeamFinal;
        stages.push(next);
      }
      const stage = stages.at(-1);
      const time=Number.isFinite(hit.roundSecond)?roundStart+hit.roundSecond:null;
      if(timedCircuit && (time===null || !(preset.roundSeconds[round]>0)) && (!hit.castOnly||statusOnly))
        return {reason:'异常效应强化需要伤害区间的参考线计时，请补齐工程计时后重新应用。'};
      const applicationActive=!!timedCircuit && time!==null && time<(stage.applicationUntil??-Infinity);
      if(timedCircuit && hit.statusApplication)stage.applicationUntil=time+timedCircuit;
      if(hit.castOnly){if(rule?.echo)recordStack(hit,stage,rule,round,roster,forgetMode);continue;}
      let factor=damageFactor?damageFactor(hit,boss,round,applicationActive):1;
      if(rule){
        const equippedEcho=hit.echoName || (hit.echo && /\(声骸技能\)$/.test(hit.name));
        const damageStacks=rule.echo && equippedEcho ? 2 : (stage.stacks??0);
        let extra=damageStacks*(rule.tuneBreak??rule.echo??0);
        if(rule.fullStacks && damageStacks===rule.maxStacks)extra+=rule.fullStacks;
        if(hit.abnormal)extra+=rule.abnormal??0;
        extra+=stage.hiyukiTeamFinal??0;
        if((hit.finalZone??1)>0)factor+=extra/(100*(hit.finalZone??1));
        const vulnerability=hit.vulnerabilityZone??1;
        if(rule.vulnerability && vulnerability>0)factor*=Math.max(0,1+rule.vulnerability/(100*vulnerability));
        // The triggering hit uses the previous stack count, including the fifth Echo.
        if(rule.maxStacks)recordStack(hit,stage,rule,round,roster,forgetMode);
      }
      const damage=baseDamage*Math.max(0,factor);
      const effective = Math.min(hp, damage);
      applied += effective; lost += damage - effective;
      stage.lost += damage - effective; stage.hits++; count++;
      hp -= effective;
      const before = end;
      if (hp <= 0) {
        kills++; bonuses += wave.kill_bonus;
        stage.finisher = hit.source+' · '+hit.name+' 第'+hit.part+'击';
        stage.bonus = wave.kill_bonus;
        end = wave.cumulative_points_after;
        index++;
        hp = waves[index]?.max_hp ?? 0;
      } else {
        end = Math.max(before, wave.cumulative_points_before + Math.floor((wave.max_hp - hp) * wave.points_per_damage + 1e-8));
      }
      stage.score += end-before;
    }
    roundStart+=preset.roundSeconds?.[round]??0;
  }
  const last = stages.at(-1);
  if (stages.length > 1 && !last.finisher && last.score < 300) {
    last.uncreditedScore = last.score;
    last.score = 0;
    end = waves[last.index].cumulative_points_before;
  }
  return {score:end-start, end, applied, lost, bonuses, kills, count, stages, capped:index===waves.length};
}
