import { visibleWaves, locateScore, packTeams, reorderTeams, nearestTeamSlot, characterIdentity, validateConfig, staminaLimits, defaultTeamName, splitQuickTeams, axisTickStep, MIN_ZOOM, MAX_ZOOM } from './score-axis.js';

const $ = id => document.getElementById(id);
const LABEL = 112;
const COLORS = ['#e6bd79', '#79c8c6', '#a9a1e6', '#e39599', '#8fb78c', '#82b2db'];
const STORAGE = 'wuwa-matrix-demo-v1';
const nf = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const fmt = value => nf.format(value);
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const [scores, characterData, bossData, example, elementData, staminaRules] = await Promise.all(['data/scores.json', 'data/characters.json', 'data/bosses_16.json', 'config/demo.json', 'data/elements.json', 'config/stamina.json'].map(async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法加载 ${url}`);
  return response.json();
}));
const characters = characterData.entries.filter(entry => !entry.download_failed);
const characterMap = new Map(characters.map(entry => [entry.id, entry]));
const characterIds = new Set(characterMap.keys());
const identityById = new Map(characters.map(entry => [entry.id, characterIdentity(entry)]));
const bossMap = new Map(bossData.entries.map(entry => [entry.name, entry]));
let state = structuredClone(example);
let repairedRosters = false;
let removedOutOfRangeMarker = false;
try {
  const saved = localStorage.getItem(STORAGE);
  if (saved) {
    if (!localStorage.getItem(`${STORAGE}-before-connected-v2`)) localStorage.setItem(`${STORAGE}-before-connected-v2`, saved);
    const previous = JSON.parse(saved);
    if (previous.scoreMarker != null && previous.scoreMarker > scores.records.at(-1).cumulative_points_after) {
      previous.scoreMarker = null; removedOutOfRangeMarker = true;
    }
    const used = new Map();
    const limits = staminaLimits(staminaRules, previous.staminaSeason, identityById);
    for (const team of previous.teams || []) {
      const roster = [];
      const own = new Set();
      for (const id of team.characterIds || []) {
        const identity = identityById.get(id);
        const count = used.get(identity) || 0;
        if (!identity || own.has(identity) || count >= (limits.get(identity) || 1)) { repairedRosters = true; continue; }
        used.set(identity, count + 1); own.add(identity); roster.push(id);
      }
      team.characterIds = roster;
      if (roster.length < 3) team.needsCharacters = true;
    }
    const required = previous.teams.reduce((sum, team) => sum + team.score, 0);
    const sufficient = scores.records.find(wave => wave.cumulative_points_after >= required);
    if (sufficient && sufficient.round > previous.maxRound) previous.maxRound = sufficient.round;
    state = validateConfig(previous, characterIds, scores.records, identityById, staminaRules);
  }
} catch { /* Use the included example when local storage is unavailable or obsolete. */ }
state.teams = packTeams(state.teams);
let selectedId = state.teams[0]?.id;
let picked = [];
let toastTimer;
let dragging = false;
let pendingTeam = null;
let activeElement = 0;
let dialogAutoName = true;
let suppressDoubleClickUntil = 0;
let quickSession = null;
const quickSequence = () => quickSession.history[quickSession.cursor];
const current = () => state.teams.find(team => team.id === selectedId);
const waves = () => visibleWaves(scores.records, state.maxRound);
const total = () => waves().at(-1).cumulative_points_after;

function normalizeTeamNames() {
  const formerExamples = { 'team-1': '今汐队', 'team-2': '相里要队', 'team-3': '椿队' };
  for (const team of state.teams) {
    const generated = defaultTeamName(team.characterIds, characterMap);
    if (!team.nameMode) team.nameMode = team.name === generated || team.name === formerExamples[team.id] || /^队伍\s*\d+$/.test(team.name) ? 'auto' : 'custom';
    if (team.nameMode === 'auto' && generated) team.name = generated;
  }
}

function toast(message) {
  const dialog = $('character-dialog');
  (dialog.open ? dialog : document.body).append($('toast'));
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500);
}

function persist() {
  try { localStorage.setItem(STORAGE, JSON.stringify(state)); }
  catch { $('save-state').textContent = '请导出 JSON 保存配置'; }
}

function characterUsage(excludeTeamId) {
  const used = new Map();
  for (const team of state.teams) {
    if (team.id === excludeTeamId) continue;
    for (const id of team.characterIds) {
      const identity = identityById.get(id);
      if (!used.has(identity)) used.set(identity, []);
      used.get(identity).push(team.name);
    }
  }
  return used;
}

function renderStaminaSeason() {
  const selected = staminaRules.seasons.find(season => season.id === state.staminaSeason);
  $('stamina-season').value = selected.id;
  $('stamina-season').title = `${selected.name}（仅体力规则）`;
  const bonusNames = selected.bonusCharacterIds.map(id => characterMap.get(id).name).join('、');
  const baseNames = Object.keys(staminaRules.baseStamina).map(id => characterMap.get(id).name);
  $('stamina-season-note').textContent = `${bonusNames} 临时 +${selected.extraStamina} 体；${baseNames.length} 名角色基础 2 体`;
  $('stamina-season-note').title = `基础 2 体：${baseNames.join('、')}。切换此项仅改变体力规则，血线仍使用本期分数表。`;
}

function portrait(id, className = 'portrait') {
  const entry = characterMap.get(id);
  const image = element('img', className);
  image.src = entry.icon_file;
  image.alt = entry.name;
  image.title = entry.name;
  image.draggable = false;
  return image;
}

function renderList() {
  $('team-list').replaceChildren();
  $('team-count').textContent = state.teams.length;
  for (const team of state.teams) {
    const button = element('button', `team-card${team.id === selectedId ? ' active' : ''}`);
    button.style.setProperty('--team-color', team.color);
    button.dataset.id = team.id;
    button.setAttribute('aria-label', `选择${team.name}`);
    const main = element('div', 'team-card-main');
    main.append(element('div', 'team-card-title', team.name + (team.needsCharacters ? ' · 待补选' : '')));
    const images = element('div', 'tiny-portraits');
    team.characterIds.forEach(id => images.append(portrait(id)));
    main.append(images);
    button.append(main, element('span', 'team-card-score', team.needsScore ? '待填分数' : `${fmt(team.score)} 分`));
    button.addEventListener('click', () => { selectedId = team.id; renderList(); renderEditor(); renderPositions(); });
    $('team-list').append(button);
  }
  if (!state.teams.length) $('team-list').append(element('div', 'empty-list', '新建一支队伍开始排布'));
}

function renderEditor() {
  const team = current();
  $('team-form').inert = !team;
  $('team-form').style.opacity = team ? '1' : '.4';
  $('delete-team').disabled = !team;
  $('team-name').value = team?.name || '';
  $('team-score').value = team?.needsScore ? '' : team?.score ?? '';
  $('team-start').value = team ? Math.round(team.startScore * 100) / 100 : '';
  $('selected-characters').replaceChildren();
  for (let slot = 0; slot < (team ? 3 : 0); slot++) {
    const id = team.characterIds[slot];
    const button = element('button', 'character-slot');
    button.type = 'button';
    if (id) button.append(portrait(id), element('span', '', characterMap.get(id).name));
    else button.append(element('div', 'empty-portrait', '＋'), element('span', '', '选择角色'));
    button.addEventListener('click', openCharacters);
    $('selected-characters').append(button);
  }
}

function locationText(position) {
  const name = `${position.wave.name}${position.wave.estimated ? '（推算）' : ''}`;
  if (position.inBonus) return `R${position.wave.round} ${name} · 击杀奖励区 · 剩余 ${fmt(position.remainingPoints)} 分`;
  if (position.completed) return `R${position.wave.round} ${name} · 已击败 · 剩余 0 分`;
  return `R${position.wave.round} ${name} · 剩余 ${(position.remainingHp * 100).toFixed(1)}% · 剩余分数 ${fmt(position.remainingPoints)} 分`;
}

function renderLocation(node, position) {
  const text = locationText(position);
  const value = `${fmt(position.remainingPoints)} 分`;
  const offset = text.lastIndexOf(value);
  node.replaceChildren(document.createTextNode(text.slice(0, offset)), element('span', 'remaining-score-value', value));
}

function renderScoreMarker() {
  $('score-marker')?.remove();
  const value = state.scoreMarker;
  $('clear-score-marker').disabled = value == null;
  $('target-score').value = value ?? '';
  if (value == null) { $('target-score-location').textContent = '输入目标总分，定位到对应 Boss 并标记。'; return; }
  const position = locateScore(value, waves());
  renderLocation($('target-score-location'), position);
  const marker = element('div', 'score-marker');
  marker.id = 'score-marker'; marker.dataset.score = value;
  marker.style.left = `${LABEL + value * state.pixelsPerPoint}px`;
  const flag = element('span', `score-marker-label${value > total() / 2 ? ' align-end' : ''}`, `目标 ${fmt(value)} 分`);
  marker.append(flag); $('axis-sheet').append(marker);
}

function scrollToScore(value) {
  const viewport = $('timeline-viewport');
  viewport.scrollTo({ left: Math.max(0, value * state.pixelsPerPoint - (viewport.clientWidth - LABEL) / 2), behavior: 'smooth' });
}

function editAxisTeam(id) {
  selectedId = id; pendingTeam = null;
  renderList(); renderEditor(); renderPositions(); openCharacters();
}

function hideTeamTooltip() {
  $('team-tooltip').hidden = true;
}

function positionTeamTooltip(x, y) {
  const tooltip = $('team-tooltip');
  const bounds = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(12, Math.min(x + 15, window.innerWidth - bounds.width - 12))}px`;
  const top = y + 17 + bounds.height > window.innerHeight - 12 ? y - bounds.height - 14 : y + 17;
  tooltip.style.top = `${Math.max(12, Math.min(top, window.innerHeight - bounds.height - 12))}px`;
}

function showTeamTooltip(team, x, y) {
  if (dragging) return;
  const tooltip = $('team-tooltip');
  tooltip.replaceChildren();
  tooltip.style.setProperty('--team-color', team.color);
  const title = element('div', 'tooltip-title', team.name);
  title.append(element('strong', '', `${fmt(team.score)} 分`));
  const roster = element('div', 'tooltip-roster');
  team.characterIds.forEach(id => {
    const member = element('div', 'tooltip-member');
    member.append(portrait(id), element('span', '', characterMap.get(id).name));
    roster.append(member);
  });
  if (team.needsCharacters) roster.append(element('span', 'muted', '阵容待补选'));
  tooltip.append(title, roster);
  for (const [label, score] of [['起点', team.startScore], ['终点', team.startScore + team.score]]) {
    const detail = element('div', 'tooltip-detail');
    const location = element('strong');
    renderLocation(location, locateScore(score, waves()));
    detail.append(element('span', 'muted', label), location, element('small', '', `累计 ${fmt(score)} 分`));
    tooltip.append(detail);
  }
  tooltip.hidden = false;
  positionTeamTooltip(x, y);
}

function renderInspector() {
  const team = current();
  $('selection-name').textContent = team?.name || '尚未选择队伍';
  $('selection-roster').replaceChildren();
  for (const id of team?.characterIds || []) {
    const member = element('div', 'selection-member');
    member.append(portrait(id), element('span', '', characterMap.get(id).name));
    $('selection-roster').append(member);
  }
  if (team?.needsCharacters) $('selection-roster').append(element('span', 'muted', '阵容待补选'));
  $('selection-score').replaceChildren();
  if (team?.needsScore) {
    $('selection-score').textContent = '待填分数';
    $('selection-score').style.color = team.color;
    $('selection-dot').style.background = team.color;
    $('start-location').textContent = '填写分数后显示';
    $('end-location').textContent = '填写分数后显示';
    $('start-points').textContent = '';
    $('end-points').textContent = '';
    $('endpoint-note').textContent = '队伍已加入序列。双击待填队伍，或在左侧填写分数后，显示对应的血线长度。';
    $('endpoint-note').parentElement.classList.remove('warning');
    return;
  }
  if (!team) {
    for (const id of ['start-location', 'end-location', 'start-points', 'end-points', 'endpoint-note']) $(id).textContent = '—';
    return;
  }
  $('selection-dot').style.background = team.color;
  $('selection-score').style.color = team.color;
  $('selection-score').append(document.createTextNode(fmt(team.score)), element('small', '', '分'));
  const start = locateScore(team.startScore, waves());
  const end = locateScore(team.startScore + team.score, waves());
  renderLocation($('start-location'), start);
  renderLocation($('end-location'), end);
  $('start-points').textContent = `累计 ${fmt(team.startScore)} 分`;
  $('end-points').textContent = `累计 ${fmt(team.startScore + team.score)} 分`;
  const bonus = start.inBonus || end.inBonus;
  $('endpoint-note').textContent = bonus ? '端点落在矩阵奇藏奖励区，此区间没有可停留的血线。调整本队或前序队伍得分可改变终点。' : '第一队从 0 分开始，队伍之间首尾相接。拖动色条或按左右键调整出场顺序。';
  $('endpoint-note').parentElement.classList.toggle('warning', bonus);
}

function renderPositions() {
  for (const bar of document.querySelectorAll('.team-bar')) {
    const team = state.teams.find(item => item.id === bar.dataset.id);
    bar.style.left = `${LABEL + team.startScore * state.pixelsPerPoint}px`;
    bar.classList.toggle('is-selected', team.id === selectedId);
    bar.setAttribute('aria-valuenow', team.startScore.toFixed(2));
    bar.setAttribute('aria-valuetext', `起点 ${fmt(team.startScore)} 分，终点 ${fmt(team.startScore + team.score)} 分`);
  }
  const team = current();
  for (const card of document.querySelectorAll('.pending-team')) card.classList.toggle('active', card.dataset.id === selectedId);
  for (const guide of document.querySelectorAll('.axis-guide')) {
    guide.hidden = !team || team.needsScore;
    if (team) {
      guide.style.left = `${LABEL + (team.startScore + (guide.classList.contains('end') ? team.score : 0)) * state.pixelsPerPoint}px`;
      guide.style.setProperty('--guide-color', team.color);
    }
  }
  if (team && !document.activeElement?.closest('#team-form')) $('team-start').value = Math.round(team.startScore * 100) / 100;
  renderInspector();
}

function startDrag(event, team, bar) {
  if (event.button !== 0) return;
  event.preventDefault();
  selectedId = team.id;
  dragging = true;
  hideTeamTooltip();
  renderList(); renderEditor(); renderPositions();
  const initialX = event.clientX;
  const initialStart = team.startScore;
  const initialIndex = state.teams.findIndex(item => item.id === team.id);
  let targetIndex = initialIndex;
  let moved = false;
  const viewport = $('timeline-viewport');
  const initialScroll = viewport.scrollLeft;
  bar.focus({ preventScroll: true });
  bar.setPointerCapture(event.pointerId);
  const move = moveEvent => {
    if (!moved && Math.abs(moveEvent.clientX - initialX) < 4) return;
    moved = true;
    const bounds = viewport.getBoundingClientRect();
    if (moveEvent.clientX > bounds.right - 38) viewport.scrollLeft += 16;
    if (moveEvent.clientX < bounds.left + LABEL + 20) viewport.scrollLeft -= 16;
    const deltaX = moveEvent.clientX - initialX + viewport.scrollLeft - initialScroll;
    targetIndex = nearestTeamSlot(state.teams, team.id, initialStart + deltaX / state.pixelsPerPoint);
    const proposed = reorderTeams(state.teams, team.id, targetIndex).find(item => item.id === team.id);
    $('team-drop-marker').hidden = false;
    $('team-drop-marker').style.left = `${LABEL + proposed.startScore * state.pixelsPerPoint}px`;
    $('team-drop-marker').textContent = `第 ${targetIndex + 1} 队`;
    $('coverage-note').textContent = `松开后排为第 ${targetIndex + 1} 队 · 首尾自动吸附`;
  };
  const finish = finishEvent => {
    dragging = false;
    bar.removeEventListener('pointermove', move);
    bar.removeEventListener('pointerup', finish);
    bar.removeEventListener('pointercancel', finish);
    if (finishEvent.type === 'pointercancel') { renderTimeline(); return; }
    if (!moved) return;
    suppressDoubleClickUntil = Date.now() + 300;
    state.teams = reorderTeams(state.teams, team.id, targetIndex);
    persist(); renderAll();
  };
  bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', finish);
  bar.addEventListener('pointercancel', finish);
}

function renderTimeline() {
  hideTeamTooltip();
  const sheet = $('axis-sheet');
  sheet.replaceChildren();
  sheet.style.width = `${LABEL + total() * state.pixelsPerPoint + 24}px`;
  const ruler = element('div', 'score-ruler');
  ruler.append(element('div', 'axis-label', '累计积分'));
  sheet.append(ruler);
  const lane = element('div', 'team-lane shared-team-lane');
  const laneLabel = element('div', 'axis-label', '队伍排布');
  laneLabel.append(element('small', '', '悬停查看 · 拖动排序'));
  lane.append(laneLabel);
  state.teams.filter(team => !team.needsScore).forEach(team => {
    const width = team.score * state.pixelsPerPoint;
    const bar = element('button', `team-bar${width < 150 ? ' narrow' : ''}`);
    bar.dataset.id = team.id;
    bar.style.width = `${width}px`;
    if (width < 40) bar.style.paddingInline = '0';
    if (width < 4) bar.style.borderWidth = '0';
    bar.style.setProperty('--team-color', team.color);
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-orientation', 'horizontal');
    bar.setAttribute('aria-description', '双击或按回车编辑队伍；拖动或使用左右键调整顺序');
    bar.setAttribute('aria-describedby', 'team-tooltip');
    bar.setAttribute('aria-label', `${team.name}分数条`);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', Math.max(0, total() - team.score));
    const portraits = element('div', 'bar-portraits');
    team.characterIds.forEach(id => portraits.append(portrait(id)));
    const text = element('div');
    text.append(element('strong', '', team.name), element('div', 'bar-score', `${fmt(team.score)} 分`));
    bar.append(portraits, text, element('span', 'bar-grip', '⠿'));
    bar.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') showTeamTooltip(team, event.clientX, event.clientY); });
    bar.addEventListener('pointermove', event => { if (!dragging && !$('team-tooltip').hidden) positionTeamTooltip(event.clientX, event.clientY); });
    bar.addEventListener('pointerleave', hideTeamTooltip);
    bar.addEventListener('blur', hideTeamTooltip);
    bar.addEventListener('focus', () => {
      if (bar.matches(':focus-visible')) {
        const bounds = bar.getBoundingClientRect();
        showTeamTooltip(team, Math.max(LABEL, bounds.left), bounds.bottom);
      }
    });
    bar.addEventListener('pointerdown', event => startDrag(event, team, bar));
    bar.addEventListener('dblclick', event => {
      event.preventDefault();
      if (!dragging && Date.now() >= suppressDoubleClickUntil) editAxisTeam(team.id);
    });
    bar.addEventListener('focus', () => { if (selectedId !== team.id && !dragging) { selectedId = team.id; renderList(); renderEditor(); renderPositions(); } });
    bar.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); editAxisTeam(team.id); return; }
      if (event.key === 'Escape') hideTeamTooltip();
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      selectedId = team.id;
      const index = state.teams.findIndex(item => item.id === team.id);
      state.teams = reorderTeams(state.teams, team.id, index + (event.key === 'ArrowRight' ? 1 : -1));
      persist(); renderAll();
      [...document.querySelectorAll('.team-bar')].find(node => node.dataset.id === team.id)?.focus({ preventScroll: true });
    });
    lane.append(bar);
  });
  if (!state.teams.some(team => !team.needsScore)) lane.append(element('div', 'lane-empty', '填写队伍分数后，在此显示血线长度'));
  const dropMarker = element('div', 'team-drop-marker');
  dropMarker.id = 'team-drop-marker'; dropMarker.hidden = true;
  lane.append(dropMarker); sheet.append(lane);
  const roundRow = element('div', 'round-row');
  roundRow.append(element('div', 'axis-label', '轮次'));
  const grouped = Map.groupBy(waves(), wave => wave.round);
  for (const [round, records] of grouped) {
    const bracket = element('div', 'round-bracket', `R${round}`);
    bracket.style.left = `${LABEL + records[0].cumulative_points_before * state.pixelsPerPoint}px`;
    const width = records.reduce((sum, wave) => sum + wave.full_kill_points, 0) * state.pixelsPerPoint;
    bracket.style.width = `${width}px`;
    bracket.classList.toggle('compact', width < 100);
    bracket.append(element('small', '', `${records.length} 个 Boss`)); roundRow.append(bracket);
  }
  sheet.append(roundRow);
  const bossRow = element('div', 'boss-row');
  const bossLabel = element('div', 'axis-label', 'BOSS 血线');
  bossLabel.append(element('small', '', '100% → 0%')); bossRow.append(bossLabel);
  for (const wave of waves()) {
    const width = wave.damage_points_at_full_hp * state.pixelsPerPoint;
    const segment = element('div', `boss-segment tone-${wave.boss_position}`);
    segment.dataset.wave = wave.wave_index;
    segment.style.left = `${LABEL + wave.cumulative_points_before * state.pixelsPerPoint}px`;
    segment.style.width = `${width}px`;
    segment.classList.toggle('overview-boss', width < 85);
    segment.classList.toggle('projected-boss', Boolean(wave.estimated));
    segment.dataset.estimated = Boolean(wave.estimated);
    segment.title = `R${wave.round} ${wave.name}${wave.estimated ? '（按原表规律推算）' : '（原表）'}：伤害积分 ${fmt(wave.damage_points_at_full_hp)}${wave.kill_bonus ? '，击杀额外 1000 分' : ''}`;
    const art = element('img', 'boss-art'); art.src = bossMap.get(wave.name).icon_file; art.alt = ''; art.loading = 'lazy';
    const name = element('div', 'boss-name', `R${wave.round} ${wave.name}${wave.estimated ? '（推算）' : ''}`);
    name.append(element('span', '', `${fmt(wave.damage_points_at_full_hp)} 分`));
    segment.append(art, element('div', 'boss-art-shade'), name, element('div', 'hp-line'));
    const percentages = width > 180 ? [100, 75, 50, 25, 0] : width > 125 ? [100, 50, 0] : width > 55 ? [100, 0] : [];
    for (const hp of percentages) {
      const tick = element('div', 'hp-tick');
      tick.style.left = `${Math.min(width - 1, width * (1 - hp / 100))}px`;
      const caption = element('span', '', `${hp}%`);
      if (hp === 100) caption.style.transform = 'translateX(5px)';
      if (hp === 0) caption.style.transform = 'translateX(calc(-100% - 5px))';
      tick.append(caption); segment.append(tick);
    }
    bossRow.append(segment);
    if (wave.kill_bonus) {
      const bonus = element('div', 'bonus-segment', '+1000');
      bonus.style.left = `${LABEL + (wave.cumulative_points_before + wave.damage_points_at_full_hp) * state.pixelsPerPoint}px`;
      bonus.style.width = `${wave.kill_bonus * state.pixelsPerPoint}px`;
      bonus.classList.toggle('overview-bonus', wave.kill_bonus * state.pixelsPerPoint < 18);
      bonus.title = '矩阵奇藏击杀奖励：没有对应的可停留血线'; bossRow.append(bonus);
    }
  }
  sheet.append(bossRow, element('div', 'axis-guide start'), element('div', 'axis-guide end'));
  const projected = waves().filter(wave => wave.estimated).length;
  $('coverage-note').textContent = `R1—R${state.maxRound} · ${waves().length - projected} 条原表${projected ? `＋${projected} 条推算` : ''}`;
  renderPositions();
  renderScoreMarker();
  renderRulerTicks();
}

function renderRulerTicks() {
  const ruler = document.querySelector('.score-ruler');
  if (!ruler) return;
  ruler.querySelectorAll('.ruler-tick').forEach(node => node.remove());
  const viewport = $('timeline-viewport');
  const step = axisTickStep(state.pixelsPerPoint);
  const first = Math.max(0, Math.floor((viewport.scrollLeft - 180) / state.pixelsPerPoint / step) * step);
  const last = Math.min(total(), (viewport.scrollLeft + viewport.clientWidth - LABEL + 180) / state.pixelsPerPoint);
  for (let value = first; value <= last; value += step) {
    const tick = element('div', 'ruler-tick');
    tick.style.left = `${LABEL + value * state.pixelsPerPoint}px`;
    const unit = value >= 1_000_000 ? 1_000_000 : 1000;
    const digits = Math.min(6, Math.max(0, Math.ceil(Math.log10(unit / step))));
    const caption = value ? `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value / unit)}${unit === 1_000_000 ? 'm' : 'k'}` : '0';
    tick.append(element('span', '', caption));
    ruler.append(tick);
  }
  const visibleLeft = viewport.scrollLeft + LABEL;
  const visibleRight = viewport.scrollLeft + viewport.clientWidth;
  document.querySelectorAll('.boss-segment').forEach(segment => {
    const left = parseFloat(segment.style.left), width = parseFloat(segment.style.width);
    if (left + width < visibleLeft || left > visibleRight) return;
    const padding = width < 85 ? 4 : 11;
    const nameLeft = Math.min(Math.max(padding, visibleLeft - left + padding), Math.max(padding, width - 100));
    const name = segment.querySelector('.boss-name');
    name.style.left = `${nameLeft}px`;
    name.style.maxWidth = `${Math.max(0, Math.min(width - nameLeft - 6, viewport.clientWidth - LABEL - 22))}px`;
  });
  document.querySelectorAll('.round-bracket').forEach(bracket => {
    const left = parseFloat(bracket.style.left), width = parseFloat(bracket.style.width);
    if (left + width < visibleLeft || left > visibleRight) return;
    const padding = width < 100 ? 3 : 13;
    bracket.style.paddingLeft = `${Math.min(Math.max(padding, visibleLeft - left + padding), Math.max(padding, width - 35))}px`;
  });
}

function renderAll() {
  normalizeTeamNames();
  renderStaminaSeason();
  $('max-round').value = state.maxRound;
  updateZoomControls();
  $('zoom-out').disabled = state.pixelsPerPoint <= MIN_ZOOM;
  $('zoom-in').disabled = state.pixelsPerPoint >= MAX_ZOOM;
  renderList(); renderEditor(); renderPendingTeams(); renderTimeline();
}

function renderPendingTeams() {
  const container = $('pending-teams');
  const pending = state.teams.filter(team => team.needsScore);
  container.hidden = pending.length === 0;
  container.replaceChildren();
  if (!pending.length) return;
  container.append(element('p', 'pending-title', `待填分数 · ${pending.length} 队（双击补分）`));
  const list = element('div', 'pending-team-list');
  for (const team of pending) {
    const card = element('button', `pending-team${team.id === selectedId ? ' active' : ''}`);
    card.dataset.id = team.id; card.style.setProperty('--team-color', team.color);
    const roster = element('div', 'tiny-portraits'); team.characterIds.forEach(id => roster.append(portrait(id)));
    card.append(element('strong', '', `第 ${state.teams.indexOf(team) + 1} 队 · ${team.name}`), roster, element('small', 'muted', '待填分数'));
    card.addEventListener('click', () => { selectedId = team.id; renderList(); renderEditor(); renderPositions(); });
    card.addEventListener('dblclick', () => editAxisTeam(team.id));
    list.append(card);
  }
  container.append(list);
}

function configurePickerMode(quick) {
  $('character-dialog').classList.toggle('quick-mode', quick);
  document.querySelector('.dialog-team-fields').hidden = quick;
  $('quick-team-panel').hidden = !quick;
}

function updateQuickSequence(sequence) {
  quickSession.history = quickSession.history.slice(0, quickSession.cursor + 1);
  quickSession.history.push([...sequence]); quickSession.cursor++;
  $('character-feedback').textContent = '';
  renderCharacters();
  $('quick-team-preview').scrollLeft = $('quick-team-preview').scrollWidth;
}

function renderQuickPreview() {
  const sequence = quickSequence();
  const groups = splitQuickTeams(sequence);
  $('quick-team-hint').textContent = `已有 ${state.teams.length} 队，从第 ${state.teams.length + 1} 队开始；每 3 人组成一队`;
  $('quick-undo').disabled = quickSession.cursor === 0;
  $('quick-redo').disabled = quickSession.cursor === quickSession.history.length - 1;
  $('quick-reset').disabled = sequence.length === 0;
  $('quick-team-preview').replaceChildren();
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const card = element('div', 'quick-preview-team');
    card.append(element('strong', '', `第 ${state.teams.length + index + 1} 队 · ${defaultTeamName(group, characterMap)}`));
    const roster = element('div', 'quick-preview-roster');
    for (let slot = 0; slot < 3; slot++) {
      const member = element('div', 'quick-preview-member');
      member.append(element('small', '', `${index * 3 + slot + 1}`));
      member.append(group[slot] ? portrait(group[slot]) : element('span', 'quick-empty-slot', '＋'));
      roster.append(member);
    }
    card.append(roster); $('quick-team-preview').append(card);
  }
  if (!groups.length) $('quick-team-preview').append(element('p', 'muted', '点击角色，按顺序填入第 1、2、3 位……'));
  $('picked-count').textContent = `${sequence.length} 人 / ${Math.floor(sequence.length / 3)} 队`;
  $('picked-names').textContent = '自动生成队名，分数稍后填写。重置仅清空本次选择，可撤回。';
  $('confirm-characters').textContent = `加入 ${Math.floor(sequence.length / 3)} 支队伍`;
  $('confirm-characters').disabled = sequence.length === 0 || sequence.length % 3 !== 0;
  if (sequence.length % 3) $('character-feedback').textContent = `当前队伍还差 ${3 - sequence.length % 3} 位角色。`;
}

function openQuickTeams() {
  if (state.teams.length >= 40) { toast('最多支持 40 支队伍'); return; }
  pendingTeam = null; hideTeamTooltip();
  quickSession = { history: [[]], cursor: 0 };
  activeElement = 0; $('character-search').value = ''; $('character-feedback').textContent = '';
  configurePickerMode(true); $('dialog-title').textContent = '快捷组队';
  renderCharacters(); $('character-dialog').showModal();
}

function openCharacters() {
  quickSession = null; configurePickerMode(false);
  const team = pendingTeam || current();
  if (!team) return;
  hideTeamTooltip();
  dialogAutoName = Boolean(pendingTeam) || team.nameMode === 'auto';
  $('dialog-team-name').value = pendingTeam ? '' : team.name;
  $('dialog-team-score').value = pendingTeam || team.needsScore ? '' : team.score;
  $('dialog-title').textContent = pendingTeam ? '新建队伍' : '编辑队伍';
  $('confirm-characters').textContent = pendingTeam ? '创建队伍' : '保存队伍';
  picked = [...team.characterIds];
  activeElement = 0;
  $('character-feedback').textContent = '';
  $('character-search').value = '';
  renderCharacters();
  $('character-dialog').showModal();
  if (pendingTeam) $('dialog-team-name').select();
}

function renderElementFilters() {
  $('element-filters').replaceChildren();
  for (const attribute of [{ id: 0, name: '全部' }, ...elementData.entries]) {
    const button = element('button', 'element-filter');
    button.type = 'button';
    button.dataset.element = attribute.id;
    button.setAttribute('aria-label', attribute.name);
    if (attribute.icon_file) {
      const icon = element('img');
      icon.src = attribute.icon_file;
      icon.alt = '';
      icon.draggable = false;
      button.append(icon);
    }
    button.append(element('span', '', attribute.name));
    button.addEventListener('click', () => { activeElement = attribute.id; renderCharacters(); });
    $('element-filters').append(button);
  }
}

function renderCharacters() {
  if (!quickSession && dialogAutoName) $('dialog-team-name').value = defaultTeamName(picked, characterMap);
  const search = $('character-search').value.trim().toLowerCase();
  $('character-grid').replaceChildren();
  const team = quickSession ? null : pendingTeam || current();
  const sequence = quickSession ? quickSequence() : [];
  const currentPicked = quickSession ? sequence.slice(Math.floor(sequence.length / 3) * 3) : picked;
  const owners = characterUsage(team?.id);
  if (quickSession) {
    for (let index = 0; index < Math.floor(sequence.length / 3) * 3; index++) {
      const identity = identityById.get(sequence[index]);
      if (!owners.has(identity)) owners.set(identity, []);
      owners.get(identity).push(`快捷第 ${state.teams.length + Math.floor(index / 3) + 1} 队`);
    }
  }
  const limits = staminaLimits(staminaRules, state.staminaSeason, identityById);
  const season = staminaRules.seasons.find(item => item.id === state.staminaSeason);
  $('picker-stamina-note').textContent = `${season.name} · ${season.bonusCharacterIds.map(id => characterMap.get(id).name).join('、')} +${season.extraStamina} 体`;
  const selectedIdentities = new Set(currentPicked.map(id => identityById.get(id)));
  for (const button of $('element-filters').children) {
    const active = Number(button.dataset.element) === activeElement;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  }
  const matches = characters.filter(item => (activeElement === 0 || item.element === activeElement) && (item.name.toLowerCase().includes(search) || item.name_en?.toLowerCase().includes(search) || item.id.includes(search)));
  $('character-result-count').textContent = `${matches.length} 位角色`;
  for (const entry of matches) {
    const selected = currentPicked.includes(entry.id);
    const button = element('button', `character-choice${selected ? ' selected' : ''}`);
    button.setAttribute('aria-label', entry.name);
    button.setAttribute('aria-pressed', selected);
    button.dataset.element = entry.element;
    const owner = owners.get(identityById.get(entry.id)) || [];
    const limit = limits.get(identityById.get(entry.id)) || 1;
    const exhausted = owner.length >= limit;
    const sameFamily = selectedIdentities.has(identityById.get(entry.id)) && !selected;
    button.disabled = quickSession ? exhausted || selectedIdentities.has(identityById.get(entry.id)) : (!selected && exhausted) || sameFamily;
    button.classList.toggle('unavailable', button.disabled);
    button.title = `${entry.name}：可上阵 ${limit} 队，其他队伍已使用 ${owner.length} 次${owner.length ? `（${owner.join('、')}）` : ''}`;
    const image = portrait(entry.id, ''); image.loading = 'lazy';
    button.append(image, element('span', '', entry.name));
    const remaining = Math.max(0, limit - owner.length - (selected ? 1 : 0));
    button.append(element('small', 'availability', sameFamily ? '已选同一角色' : exhausted ? `体力用尽 ${owner.length}/${limit}` : `剩余 ${remaining}/${limit} 体`));
    if (limit > 1) button.append(element('small', `stamina-badge${season.bonusCharacterIds.includes(entry.id) ? ' temporary' : ''}`, `${limit}体`));
    button.addEventListener('click', () => {
      if (quickSession) {
        if (sequence.length >= (40 - state.teams.length) * 3) { $('character-feedback').textContent = '已达到 40 支队伍上限。'; return; }
        updateQuickSequence([...sequence, entry.id]); return;
      }
      if (picked.includes(entry.id)) picked = picked.filter(id => id !== entry.id);
      else if (picked.length < 3) picked.push(entry.id);
      else { $('character-feedback').textContent = '每队最多 3 位角色，请先取消一位已选角色。'; return; }
      $('character-feedback').textContent = '';
      renderCharacters();
    });
    $('character-grid').append(button);
  }
  if (!matches.length) $('character-grid').append(element('p', 'empty-character-results', '没有匹配的角色，试试其他属性或清空搜索。'));
  if (quickSession) { renderQuickPreview(); return; }
  $('picked-count').textContent = `${picked.length} / 3`;
  $('picked-names').textContent = picked.map(id => characterMap.get(id).name).join(' · ');
  $('confirm-characters').disabled = picked.length !== 3;
}

$('team-form').addEventListener('submit', event => {
  event.preventDefault();
  const team = current(); if (!team) return;
  const score = Number($('team-score').value);
  const name = $('team-name').value.trim();
  if (!name || !Number.isFinite(score) || score <= 0) { toast('请输入队名与正数得分'); return; }
  if (state.teams.reduce((sum, item) => sum + (item.id === team.id ? score : item.score), 0) > total() + 1e-7) { toast('队伍总分超出当前轴，请先增加显示轮次'); return; }
  Object.assign(team, { name, score, nameMode: name === defaultTeamName(team.characterIds, characterMap) ? 'auto' : 'custom' });
  delete team.needsScore;
  state.teams = packTeams(state.teams);
  persist(); renderAll(); toast('已更新分数条');
});
$('add-team').addEventListener('click', () => {
  if (state.teams.length >= 40) { toast('Demo 最多支持 40 支队伍'); return; }
  const end = state.teams.reduce((sum, team) => sum + team.score, 0);
  pendingTeam = { id: crypto.randomUUID(), name: '', nameMode: 'auto', characterIds: [], score: 0, startScore: end, color: COLORS[state.teams.length % COLORS.length] };
  openCharacters();
});
$('delete-team').addEventListener('click', () => {
  state.teams = state.teams.filter(team => team.id !== selectedId);
  state.teams = packTeams(state.teams);
  selectedId = state.teams[0]?.id; persist(); renderAll();
});
$('confirm-characters').addEventListener('click', () => {
  if (quickSession) {
    const sequence = quickSequence();
    if (!sequence.length || sequence.length % 3) return;
    const groups = splitQuickTeams(sequence);
    if (state.teams.length + groups.length > 40) { $('character-feedback').textContent = '最多支持 40 支队伍。'; return; }
    const added = groups.map((group, index) => ({ id: crypto.randomUUID(), name: defaultTeamName(group, characterMap), nameMode: 'auto', characterIds: group, score: 0, needsScore: true, startScore: 0, color: COLORS[(state.teams.length + index) % COLORS.length] }));
    const next = { ...state, teams: packTeams([...state.teams, ...added]) };
    try { state = validateConfig(next, characterIds, scores.records, identityById, staminaRules); }
    catch (error) { $('character-feedback').textContent = error.message; return; }
    selectedId = added[0].id; quickSession = null;
    persist(); renderAll(); $('character-dialog').close(); toast(`已追加 ${added.length} 支队伍，分数待填。`);
    return;
  }
  if (picked.length !== 3) return;
  const team = pendingTeam || current();
  if (!team) return;
  const name = $('dialog-team-name').value.trim() || defaultTeamName(picked, characterMap);
  const score = Number($('dialog-team-score').value);
  if (!name || name.length > 30) { $('character-feedback').textContent = '请填写 1—30 个字符的队伍名称。'; $('dialog-team-name').focus(); return; }
  if (!$('dialog-team-score').value.trim() || !Number.isFinite(score) || score <= 0) { $('character-feedback').textContent = '请填写大于 0 的队伍分数。'; $('dialog-team-score').focus(); return; }
  const required = state.teams.filter(other => other.id !== team.id).reduce((sum, other) => sum + other.score, score);
  const sufficient = scores.records.find(wave => wave.cumulative_points_after >= required);
  if (!sufficient) { $('character-feedback').textContent = '队伍总分超出已导入的血线数据范围，请调整分数。'; return; }
  const used = characterUsage(team.id);
  const limits = staminaLimits(staminaRules, state.staminaSeason, identityById);
  if (picked.some(id => (used.get(identityById.get(id)) || []).length >= (limits.get(identityById.get(id)) || 1))) { $('character-feedback').textContent = '所选角色体力不足，请重新选择。'; renderCharacters(); return; }
  Object.assign(team, { name, score, nameMode: dialogAutoName ? 'auto' : 'custom', characterIds: [...picked] }); delete team.needsCharacters;
  delete team.needsScore;
  state.maxRound = Math.max(state.maxRound, sufficient.round);
  if (pendingTeam) { state.teams.push(team); selectedId = team.id; pendingTeam = null; }
  state.teams = packTeams(state.teams);
  persist(); renderAll(); $('character-dialog').close();
});
$('character-dialog').addEventListener('close', () => { pendingTeam = null; quickSession = null; document.body.append($('toast')); $('toast').classList.remove('visible'); });
$('quick-team').addEventListener('click', openQuickTeams);
$('quick-undo').addEventListener('click', () => { if (quickSession?.cursor > 0) { quickSession.cursor--; $('character-feedback').textContent = ''; renderCharacters(); } });
$('quick-redo').addEventListener('click', () => { if (quickSession && quickSession.cursor < quickSession.history.length - 1) { quickSession.cursor++; $('character-feedback').textContent = ''; renderCharacters(); } });
$('quick-reset').addEventListener('click', () => { if (quickSession && quickSequence().length) updateQuickSequence([]); });
document.addEventListener('keydown', event => {
  if (!quickSession || !$('character-dialog').open || !(event.ctrlKey || event.metaKey) || event.target.matches('input,textarea,[contenteditable=true]')) return;
  const key = event.key.toLowerCase();
  if (key === 'z' || key === 'y') { event.preventDefault(); $(key === 'y' || event.shiftKey ? 'quick-redo' : 'quick-undo').click(); }
});
$('close-dialog').addEventListener('click', () => $('character-dialog').close());
$('character-search').addEventListener('input', renderCharacters);
$('dialog-team-name').addEventListener('input', () => {
  dialogAutoName = !$('dialog-team-name').value.trim() || $('dialog-team-name').value.trim() === defaultTeamName(picked, characterMap);
});
for (const id of ['dialog-team-name', 'dialog-team-score']) $(id).addEventListener('keydown', event => {
  if (event.key === 'Enter' && !$('confirm-characters').disabled) { event.preventDefault(); $('confirm-characters').click(); }
});
let rulerFrame = false;
function queueRulerTicks() {
  if (rulerFrame) return;
  rulerFrame = true;
  requestAnimationFrame(() => { rulerFrame = false; renderRulerTicks(); });
}
$('timeline-viewport').addEventListener('scroll', () => { hideTeamTooltip(); queueRulerTicks(); });
window.addEventListener('resize', () => { hideTeamTooltip(); queueRulerTicks(); });
for (let round = 1; round <= Math.max(...scores.records.map(wave => wave.round)); round++) {
  const records = visibleWaves(scores.records, round).filter(wave => wave.round === round);
  const projected = records.filter(wave => wave.estimated).length;
  const option = element('option', '', `R${round}${projected ? projected === records.length ? '（推算）' : '（含推算）' : ''}`);
  option.value = round; $('max-round').append(option);
}
$('max-round').addEventListener('change', () => {
  const next = Number($('max-round').value);
  const nextTotal = visibleWaves(scores.records, next).at(-1).cumulative_points_after;
  if (state.teams.reduce((sum, team) => sum + team.score, 0) > nextTotal + 1e-7) { $('max-round').value = state.maxRound; toast('队伍总分超出该轮范围，请先调整队伍分数'); return; }
  if (state.scoreMarker != null && state.scoreMarker > nextTotal) { $('max-round').value = state.maxRound; toast('目标标记超出该轮范围，请先清除标记'); return; }
  state.maxRound = next; persist(); renderTimeline();
});
function setZoom(value) {
  const viewport = $('timeline-viewport');
  const focus = (viewport.scrollLeft + viewport.clientWidth / 2 - LABEL) / state.pixelsPerPoint;
  state.pixelsPerPoint = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
  updateZoomControls();
  $('zoom-out').disabled = state.pixelsPerPoint <= MIN_ZOOM;
  $('zoom-in').disabled = state.pixelsPerPoint >= MAX_ZOOM;
  renderTimeline();
  viewport.scrollLeft = focus * state.pixelsPerPoint + LABEL - viewport.clientWidth / 2;
  persist();
}
function updateZoomControls() {
  $('zoom').value = state.pixelsPerPoint;
  const percentage = state.pixelsPerPoint / .04 * 100;
  $('zoom-level').textContent = `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: percentage < 1 ? 3 : 1 }).format(percentage)}%`;
  $('zoom-level').title = '缩小可看到更长的排布，放大可查看细节';
}
function fitAxis(entireBloodline) {
  if (entireBloodline) state.maxRound = Math.max(...scores.records.map(wave => wave.round));
  const points = entireBloodline ? total() : state.teams.reduce((sum, team) => sum + team.score, 0) || waves()[0].full_kill_points;
  const available = Math.max(30, $('timeline-viewport').clientWidth - LABEL - 28);
  state.pixelsPerPoint = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, available / points));
  renderAll(); $('timeline-viewport').scrollLeft = 0; persist();
}
$('fit-teams').addEventListener('click', () => fitAxis(false));
$('fit-bloodline').addEventListener('click', () => fitAxis(true));
$('zoom').addEventListener('input', event => setZoom(Number(event.target.value)));
$('zoom-in').addEventListener('click', () => setZoom(state.pixelsPerPoint * 1.5));
$('zoom-out').addEventListener('click', () => setZoom(state.pixelsPerPoint / 1.5));
$('jump-selected').addEventListener('click', () => { const team = current(); if (team) $('timeline-viewport').scrollTo({ left: Math.max(0, team.startScore * state.pixelsPerPoint - 25), behavior: 'smooth' }); });
$('score-locator').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('target-score').value.trim();
  const value = Number(text);
  if (!text || !Number.isFinite(value) || value < 0) { toast('请输入不小于 0 的目标总分'); return; }
  const required = scores.records.find(wave => wave.cumulative_points_after >= value);
  if (!required) { toast('目标总分超出已导入的 Boss 数据范围'); return; }
  state.scoreMarker = value; state.maxRound = Math.max(state.maxRound, required.round);
  persist(); renderAll(); scrollToScore(value);
});
$('clear-score-marker').addEventListener('click', () => { state.scoreMarker = null; persist(); renderScoreMarker(); });
$('load-example').addEventListener('click', () => { state = structuredClone(example); selectedId = state.teams[0].id; persist(); renderAll(); $('timeline-viewport').scrollLeft = 0; toast('已恢复示例排布'); });
$('export-button').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2) + '\n'], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = '终焉矩阵排布.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error('配置文件不能超过 1 MB');
    state = validateConfig(JSON.parse(await file.text()), characterIds, scores.records, identityById, staminaRules);
    selectedId = state.teams[0]?.id; persist(); renderAll(); $('timeline-viewport').scrollLeft = 0; toast('JSON 配置已载入');
  } catch (error) { toast(`导入失败：${error.message}`); }
  event.target.value = '';
});
for (const season of staminaRules.seasons) {
  const names = season.bonusCharacterIds.map(id => characterMap.get(id).name).join('、');
  const option = element('option', '', `${season.name.split(' · ')[0]} · ${names}+${season.extraStamina}体`);
  option.value = season.id; $('stamina-season').append(option);
}
$('stamina-season').addEventListener('change', () => {
  const id = $('stamina-season').value;
  const limits = staminaLimits(staminaRules, id, identityById);
  const usage = characterUsage();
  const over = [...usage].find(([identity, teams]) => teams.length > (limits.get(identity) || 1));
  if (over) {
    const name = characters.find(entry => identityById.get(entry.id) === over[0]).name;
    $('stamina-season').value = state.staminaSeason;
    toast(`${name}已上阵 ${over[1].length} 队，切换后仅有 ${limits.get(over[0]) || 1} 体，请先调整阵容。`);
    return;
  }
  state.staminaSeason = id; persist(); renderAll();
});
$('zoom').min = MIN_ZOOM;
$('zoom').max = MAX_ZOOM;
renderElementFilters();
renderAll();
persist();
if (repairedRosters) toast('已保留原有队伍与分数，超出体力的角色已清理，请为待补选队伍重新选人。');
else if (removedOutOfRangeMarker) toast('已移除超出 R15 的旧目标标记，队伍与分数已保留。');
