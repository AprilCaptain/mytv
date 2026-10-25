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
export function createSkipSettingsUI({ api, current, onChange, choose }) {
  let data = null, editing = null, busy = false, loadSerial = 0;
  const message = (text, error = false) => { $('skip-message').textContent = text; $('skip-message').classList.toggle('error', error); };
  function lock(value) {
    busy = value;
    $('skip-global').disabled = value; $('skip-editor').disabled = value;
    for (const button of $('skip-rule-list').querySelectorAll('button')) button.disabled = value;
  }
  function reset(film = null) {
    editing = null;
    $('skip-title').value = film && !film.direct ? film.title : '';
    $('skip-year').value = /^(19|20)\d{2}$/.test(String(film?.year || '')) ? film.year : '';
    $('skip-intro').value = '00:00'; $('skip-outro').value = '00:00';
    $('skip-rule-enabled').checked = true; $('skip-save-rule').textContent = '添加规则';
    $('skip-editor-title').textContent = '新增影片';
  }
  function render() {
    $('skip-enabled').checked = data.enabled; $('skip-intro-enabled').checked = data.skipIntro; $('skip-outro-enabled').checked = data.skipOutro;
    $('skip-rule-list').replaceChildren(); $('skip-empty').hidden = data.rules.length > 0;
    for (const rule of data.rules) {
      const row = document.createElement('article'); row.className = 'skip-rule';
      const info = document.createElement('div'), title = document.createElement('h3'), detail = document.createElement('p');
      title.textContent = rule.title + (rule.year ? ' · ' + rule.year : '');
      detail.textContent = [rule.enabled ? '' : '已停用', '片头 ' + formatSkipTime(rule.intro), '片尾 ' + formatSkipTime(rule.outro)].filter(Boolean).join(' · ');
      info.append(title, detail); const actions = document.createElement('div'); actions.className = 'skip-rule-actions';
      const action = (label, handler) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'history-delete'; button.textContent = label; button.addEventListener('click', handler); actions.append(button); };
      action('编辑', () => { editing = rule.id; $('skip-title').value = rule.title; $('skip-year').value = rule.year;
        $('skip-intro').value = formatSkipTime(rule.intro); $('skip-outro').value = formatSkipTime(rule.outro);
        $('skip-rule-enabled').checked = rule.enabled; $('skip-save-rule').textContent = '保存修改'; $('skip-editor-title').textContent = '编辑影片'; $('skip-title').focus(); });
      action(rule.enabled ? '停用' : '启用', () => persist({ ...data, rules: data.rules.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r) }));
      action('删除', async () => {
        const yes = await choose('删除跳过规则？', rule.title + ' 的片头片尾设置将被删除。', [{ label: '取消', value: false }, { label: '删除', value: true }]);
        if (yes && !busy) { const ok = await persist({ ...data, rules: data.rules.filter(r => r.id !== rule.id) }); if (ok && editing === rule.id) reset(); }
      });
      row.append(info, actions); $('skip-rule-list').append(row);
    }
  }
  async function persist(next) {
    if (busy) return false;
    lock(true); message('正在保存…');
    try { data = await api('/api/skip-settings', { method: 'PUT', body: next }); render(); onChange(); message(data.enabled ? '已保存' : '已保存，自动跳过尚未开启'); return true; }
    catch (error) { render(); message(error.message, true); return false; }
    finally { lock(false); }
  }
  async function open(prefill = false) {
    if (busy) return;
    const serial = ++loadSerial;
    $('skip-dialog').showModal(); lock(true); message('正在读取设置…');
    try { const result = await api('/api/skip-settings'); if (serial !== loadSerial) return; data = result; reset(prefill ? current() : null); render(); message(''); lock(false); }
    catch (error) { message(error.message + ' 关闭后可重新打开。', true); busy = false; }
  }
  for (const id of ['skip-enabled', 'skip-intro-enabled', 'skip-outro-enabled']) $(id).addEventListener('change', () => persist({ ...data,
    enabled: $('skip-enabled').checked, skipIntro: $('skip-intro-enabled').checked, skipOutro: $('skip-outro-enabled').checked }));
  $('skip-rule-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !data) return;
    try {
      const rule = { id: editing || Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''), title: $('skip-title').value.trim(), year: $('skip-year').value.trim(),
        intro: parseSkipTime($('skip-intro').value), outro: parseSkipTime($('skip-outro').value), enabled: $('skip-rule-enabled').checked };
      if (!filmTitle(rule.title)) throw new Error('请填写影片名。');
      if (!rule.intro && !rule.outro) throw new Error('请至少设置片头或片尾时间。');
      if (data.rules.some(r => r.id !== editing && filmTitle(r.title) === filmTitle(rule.title) && r.year === rule.year)) throw new Error('这部影片已有规则，请直接编辑。');
      const rules = editing ? data.rules.map(r => r.id === editing ? rule : r) : [...data.rules, rule];
      if (await persist({ ...data, rules })) reset();
    } catch (error) { message(error.message, true); }
  });
  $('skip-new-rule').addEventListener('click', () => reset());
  $('skip-nav').addEventListener('click', () => open());
  $('watch-skip').addEventListener('click', () => open(true));
  return { open };
}
