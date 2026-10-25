import { filmTitle } from './history-utils.js';
const $ = id => document.getElementById(id);
export function parseSkipTime(value) {
  const match = String(value).trim().match(/^(\d{1,3}):([0-5]\d)$/);
  if (!match) throw new Error('时间请使用“分:秒”，例如 01:30。');
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  if (seconds > 7200) throw new Error('跳过时间最多为 120 分钟。');
  return seconds;
}
export const formatSkipTime = seconds => String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
export function skipRulePage(rules, requested = 1, pageSize = 10) {
  const pages = Math.max(1, Math.ceil(rules.length / pageSize));
  const page = Math.min(pages, Math.max(1, Math.trunc(requested) || 1));
  return { page, pages, total: rules.length, items: rules.slice((page - 1) * pageSize, page * pageSize) };
}
export function createSkipSettingsUI({ api, current, onChange, choose, onNavigate }) {
  let data = null, editing = null, busy = false, page = 1, loadSerial = 0;
  const message = (text, error = false, editor = false) => {
    const output = $(editor ? 'skip-editor-message' : 'skip-message'); output.textContent = text; output.classList.toggle('error', error);
  };
  function lock(value) {
    busy = value;
    $('skip-global').disabled = value || !data; $('skip-editor').disabled = value; $('skip-add-rule').disabled = value || !data;
    for (const button of $('skip-rule-list').querySelectorAll('button')) button.disabled = value;
    $('skip-previous').disabled = value || page <= 1;
    $('skip-next').disabled = value || !data || page >= skipRulePage(data.rules, page).pages;
  }
  function updateOutroLabel() {
    const position = $('skip-outro-mode').value === 'position';
    $('skip-outro-label').textContent = position ? '片尾开始时间' : '片尾时长';
    $('skip-outro-help').textContent = position ? '例如 10:20：播到第 10 分 20 秒时跳过片尾' : '例如 02:00：跳过最后 2 分钟';
  }
  function editor(rule = null, film = null) {
    editing = rule?.id || null;
    $('skip-title').value = rule?.title || (film && !film.direct ? film.title : '');
    $('skip-year').value = rule?.year || (/^(19|20)\d{2}$/.test(String(film?.year || '')) ? film.year : '');
    $('skip-intro').value = formatSkipTime(rule?.intro || 0); $('skip-outro').value = formatSkipTime(rule?.outro || 0);
    $('skip-outro-mode').value = rule?.outroMode || 'position';
    $('skip-rule-enabled').checked = rule ? rule.enabled : true;
    $('skip-editor-title').textContent = rule ? '编辑跳过规则' : '新增跳过规则';
    $('skip-save-rule').textContent = rule ? '保存修改' : '添加规则';
    message('', false, true); updateOutroLabel(); $('skip-dialog').showModal();
  }
  function render() {
    $('skip-enabled').checked = data.enabled; $('skip-intro-enabled').checked = data.skipIntro; $('skip-outro-enabled').checked = data.skipOutro;
    const result = skipRulePage(data.rules, page); page = result.page;
    $('skip-rule-list').replaceChildren(); $('skip-empty').hidden = data.rules.length > 0;
    $('skip-pagination').hidden = !data.rules.length;
    $('skip-page-label').textContent = `第 ${page} / ${result.pages} 页 · 共 ${result.total} 部影片`;
    $('skip-previous').disabled = page <= 1; $('skip-next').disabled = page >= result.pages;
    $('skip-master-status').textContent = data.enabled ? '自动跳过已开启' : '自动跳过已关闭';
    for (const rule of result.items) {
      const row = document.createElement('article'); row.className = 'skip-rule';
      const info = document.createElement('div'), title = document.createElement('h3'), detail = document.createElement('p');
      title.textContent = rule.title + (rule.year ? ' · ' + rule.year : '');
      const badge = document.createElement('span'); badge.className = 'skip-rule-state' + (rule.enabled ? '' : ' inactive'); badge.textContent = rule.enabled ? '已启用' : '已停用'; title.append(badge);
      const outro = !rule.outro ? '不跳过片尾' : rule.outroMode === 'position' ? '片尾从 ' + formatSkipTime(rule.outro) + ' 开始' : '跳过最后 ' + formatSkipTime(rule.outro);
      detail.textContent = [rule.intro ? '片头跳至 ' + formatSkipTime(rule.intro) : '不跳过片头', outro].join(' · ');
      info.append(title, detail); const actions = document.createElement('div'); actions.className = 'skip-rule-actions';
      const action = (label, handler) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'history-delete'; button.textContent = label; button.setAttribute('aria-label', label + '：' + rule.title); button.addEventListener('click', handler); actions.append(button); };
      action('编辑', () => editor(rule));
      action(rule.enabled ? '停用' : '启用', () => persist({ ...data, rules: data.rules.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r) }));
      action('删除', async () => {
        const yes = await choose('删除跳过规则？', rule.title + ' 的片头片尾设置将被删除。', [{ label: '取消', value: false }, { label: '删除', value: true }]);
        if (yes && !busy) await persist({ ...data, rules: data.rules.filter(r => r.id !== rule.id) });
      });
      row.append(info, actions); $('skip-rule-list').append(row);
    }
  }
  async function persist(next, fromEditor = false) {
    if (busy) return false;
    lock(true); message('正在保存…', false, fromEditor);
    try {
      data = await api('/api/skip-settings', { method: 'PUT', body: next }); if (fromEditor && !editing) page = 1; render(); onChange();
      message(data.enabled ? '已保存' : '已保存，自动跳过尚未开启');
      if (fromEditor) $('skip-dialog').close();
      return true;
    } catch (error) { render(); message(error.message, true, fromEditor); return false; }
    finally { lock(false); }
  }
  async function load() {
    if (busy) return false;
    const serial = ++loadSerial; lock(true); message('正在读取设置…');
    try {
      const result = await api('/api/skip-settings'); if (serial !== loadSerial) return false;
      data = result; render(); message(''); return true;
    } catch (error) { message(error.message + ' 请重试。', true); return false; }
    finally { lock(false); }
  }
  async function openPage() { onNavigate(); page = 1; await load(); }
  async function editCurrent() {
    if (!await load()) return;
    const film = current();
    const matching = film && !film.direct ? data.rules.filter(r => filmTitle(r.title) === filmTitle(film.title)) : [];
    const rule = matching.find(r => r.year && r.year === String(film?.year || '')) || matching.find(r => !r.year);
    editor(rule, film);
  }
  for (const id of ['skip-enabled', 'skip-intro-enabled', 'skip-outro-enabled']) $(id).addEventListener('change', () => persist({ ...data,
    enabled: $('skip-enabled').checked, skipIntro: $('skip-intro-enabled').checked, skipOutro: $('skip-outro-enabled').checked }));
  $('skip-rule-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !data) return;
    try {
      const rule = { id: editing || Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''), title: $('skip-title').value.trim(), year: $('skip-year').value.trim(),
        intro: parseSkipTime($('skip-intro').value), outro: parseSkipTime($('skip-outro').value), outroMode: $('skip-outro-mode').value, enabled: $('skip-rule-enabled').checked };
      if (!filmTitle(rule.title)) throw new Error('请填写影片名。');
      if (!rule.intro && !rule.outro) throw new Error('请至少设置片头或片尾时间。');
      if (rule.outroMode === 'position' && rule.outro && rule.intro >= rule.outro) throw new Error('片尾开始时间应晚于片头结束时间。');
      if (data.rules.some(r => r.id !== editing && filmTitle(r.title) === filmTitle(rule.title) && r.year === rule.year)) throw new Error('这部影片已有规则，请直接编辑。');
      const rules = editing ? data.rules.map(r => r.id === editing ? rule : r) : [rule, ...data.rules];
      await persist({ ...data, rules }, true);
    } catch (error) { message(error.message, true, true); }
  });
  $('skip-outro-mode').addEventListener('change', updateOutroLabel);
  $('skip-add-rule').addEventListener('click', () => editor());
  $('skip-reload').addEventListener('click', load);
  $('skip-previous').addEventListener('click', () => { page--; render(); });
  $('skip-next').addEventListener('click', () => { page++; render(); });
  $('skip-nav').addEventListener('click', openPage);
  $('watch-skip').addEventListener('click', editCurrent);
  lock(true); busy = false;
  return { open: openPage, load };
}
