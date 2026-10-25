import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSkipSettings, defaultSkipSettings } from '../lib/skip-settings.mjs';
import { createApi } from '../lib/api.mjs';
import { matchingSkipRule, skipDecision, createSkipPlayback } from '../public/skip-playback.js';
import { parseSkipTime, skipRulePage } from '../public/skip-settings-ui.js';
const rule = (extra = {}) => ({ id: 'film-1', title: '测试剧 第一季', year: '2026', enabled: true, intro: 90, outro: 120, mode: 'duration', ...extra });
const settings = (extra = {}) => ({ ...defaultSkipSettings(), enabled: true, rules: [rule()], ...extra });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mytv-skip-')); t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: await openSkipSettings(root) };
}
test('跳过设置首次默认关闭，保存、停用、物理删除、重启保留，与观看历史独立', async t => {
  const { root, store } = await fixture(t);
  assert.equal(store.get().enabled, false);
  await assert.rejects(readFile(join(root, 'data/playback-settings.json')), { code: 'ENOENT' });
  const first = await store.update(settings()); assert.equal(first.revision, 1);
  const reopened = await openSkipSettings(root); assert.deepEqual(reopened.get(), first);
  const disabled = await store.update({ ...first, rules: [rule({ enabled: false })] });
  const cleared = await store.update({ ...disabled, rules: [] });
  assert.deepEqual(JSON.parse(await readFile(join(root, 'data/playback-settings.json'), 'utf8')), cleared);
  assert.deepEqual((await openSkipSettings(root)).get().rules, []);
});
test('并发更新拒绝旧版本，失败请求不污染内存或后续保存', async t => {
  const { store } = await fixture(t);
  const results = await Promise.allSettled([store.update(settings()), store.update(settings({ skipIntro: false }))]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.status, 409);
  assert.equal(store.get().skipIntro, true);
  await assert.rejects(async () => store.update(settings({ revision: 1, rules: [rule({ intro: -1 })] })), { status: 400 });
  await store.update({ ...store.get(), enabled: false }); assert.equal(store.get().enabled, false);
});
test('损坏设置保留原文件；写入失败不改变已加载设置', async t => {
  const { root, store } = await fixture(t); await mkdir(join(root, 'data'));
  const file = join(root, 'data/playback-settings.json'); await writeFile(file, '{broken');
  await assert.rejects(openSkipSettings(root), /原文件已保留/); assert.equal(await readFile(file, 'utf8'), '{broken');
  await rm(file); await mkdir(file); await assert.rejects(store.update(settings()), { status: 500 });
  assert.equal(store.get().revision, 0);
});
test('API 同源校验、输入校验与读写共享设置', async t => {
  const { store } = await fixture(t); const api = createApi(undefined, { skipSettings: store }); t.after(() => api.close());
  const request = (method, body, headers = {}) => new Request('http://localhost/api/skip-settings', { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await api(request('PUT', settings(), { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await api(request('PUT', settings({ rules: [rule({ intro: Infinity })] })))).status, 400);
  assert.equal((await api(request('PUT', settings({ rules: [rule(), rule({ id: 'film-2' })] })))).status, 400);
  assert.equal((await api(request('PUT', settings()))).status, 200);
  assert.equal((await (await api(request('GET'))).json()).rules[0].intro, 90);
  assert.equal((await api(request('PUT', settings()))).status, 409);
});
test('按规范化片名及可选年份匹配，不模糊匹配其它季或直接链接', () => {
  const data = settings();
  assert.ok(matchingSkipRule(data, { title: '测试剧 第1季 [4K]', year: '2026' }));
  assert.equal(matchingSkipRule(data, { title: '测试剧 第2季', year: '2026' }), null);
  assert.equal(matchingSkipRule(data, { title: rule().title, year: '2025' }), null);
  assert.equal(matchingSkipRule(data, { title: rule().title }), null);
  assert.equal(matchingSkipRule(data, { title: rule().title, year: '2026', direct: true }), null);
  assert.equal(matchingSkipRule(settings({ enabled: false }), { title: rule().title, year: '2026' }), null);
  assert.equal(matchingSkipRule(settings({ rules: [rule({ year: '' }), rule()] }), { title: rule().title, year: '2026' }).year, '2026');
});
test('片头片尾独立开关、已跳过不重复、短视频和未知时长不盲目跳转', () => {
  const input = { position: 0, duration: 2400 };
  assert.deepEqual(skipDecision(settings(), rule(), input), { kind: 'intro', target: 90 });
  assert.equal(skipDecision(settings({ skipIntro: false }), rule(), input), null);
  assert.equal(skipDecision(settings(), rule(), { ...input, introDone: true }), null);
  assert.equal(skipDecision(settings(), rule(), { ...input, position: 2290 }).kind, 'outro');
  assert.equal(skipDecision(settings({ skipOutro: false }), rule(), { ...input, position: 2290 }), null);
  assert.equal(skipDecision(settings(), rule(), { ...input, position: 2290, outroDone: true }), null);
  assert.equal(skipDecision(settings(), rule(), { ...input, duration: 200 }).kind, 'intro');
  assert.equal(skipDecision(settings(), rule(), { ...input, duration: 200, position: 100 }).kind, 'invalid');
  assert.equal(skipDecision(settings(), rule(), { ...input, duration: 50 }).kind, 'invalid');
  assert.equal(skipDecision(settings(), rule(), { ...input, duration: Infinity }), null);
  assert.equal(parseSkipTime('01:30'), 90); assert.equal(parseSkipTime('120:00'), 7200);
  for (const value of ['01:99', '-1:30', '1.5', '121:00']) assert.throws(() => parseSkipTime(value));
});
test('实际播放器先等待续播与可跳转范围，换集重置；手动回看片头不会反复跳过', async t => {
  const video = new EventTarget(); Object.assign(video, { paused: false, ended: false, seeking: false, readyState: 4, duration: 2400, currentTime: 0, seekable: { length: 0 } });
  let ready = false; const notices = [];
  const playback = createSkipPlayback({ video, api: async () => settings(), current: () => ({ title: rule().title, year: '2026' }), ready: () => ready, notice: text => notices.push(text) });
  t.after(() => playback.dispose()); await playback.refresh();
  video.dispatchEvent(new Event('timeupdate')); assert.equal(video.currentTime, 0);
  ready = true; video.dispatchEvent(new Event('timeupdate')); assert.equal(video.currentTime, 0);
  video.seekable = { length: 1, start: () => 0, end: () => 2400 };
  video.dispatchEvent(new Event('timeupdate')); assert.equal(video.currentTime, 90);
  video.currentTime = 10; video.dispatchEvent(new Event('timeupdate')); assert.equal(video.currentTime, 10);
  playback.reset(); await playback.refresh(); video.currentTime = 500; video.dispatchEvent(new Event('playing'));
  video.currentTime = 10; video.dispatchEvent(new Event('timeupdate')); assert.equal(video.currentTime, 10);
  video.currentTime = 2300; video.dispatchEvent(new Event('timeupdate')); assert.equal(video.currentTime, 2399.95);
  assert.ok(notices.includes('已跳过片尾'));
  playback.reset(); video.currentTime = 0; await playback.refresh(); video.dispatchEvent(new Event('timeupdate')); assert.equal(video.currentTime, 90);
});


test('炼气十万年：片头 02:55 / 片尾从 10:20 开始，续播正文不回退，片尾无效也不连带禁用片头', () => {
  const r = rule({ title: '炼气十万年', year: '', intro: 175, outro: 620, mode: 'position' });
  const data = settings({ rules: [r] });
  assert.deepEqual(skipDecision(data, r, { position: 0, duration: 752 }), { kind: 'intro', target: 175 });
  assert.equal(skipDecision(data, r, { position: 541, duration: 752 }), null);
  assert.deepEqual(skipDecision(data, r, { position: 620, duration: 752 }), { kind: 'outro', target: 751.95 });
  const old = { ...r, mode: 'duration' };
  assert.equal(skipDecision(data, old, { position: 0, duration: 752 }).kind, 'intro');
  assert.match(skipDecision(data, old, { position: 0, duration: 752 }).warning, /片尾/);
  assert.equal(skipDecision(data, { ...r, intro: 900 }, { position: 620, duration: 752 }).kind, 'outro');
});

test('旧设置升级保留倒数含义，不猜测历史规则；未知版本与旧客户端写入被拒绝', async t => {
  const { root } = await fixture(t); await mkdir(join(root, 'data'));
  const file = join(root, 'data/playback-settings.json');
  const old = { ...settings(), version: 1 };
  await writeFile(file, JSON.stringify(old));
  const store = await openSkipSettings(root);
  assert.equal(store.get().version, 3); assert.equal(store.get().rules[0].mode, 'duration');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 1);
  await assert.rejects(async () => store.update(old), { status: 400 });
  await store.update(store.get()); assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 3);
  await writeFile(file, JSON.stringify({ ...old, version: 99 })); await assert.rejects(openSkipSettings(root), /原文件已保留/);
});

test('规则分页只显示当前十条，删除最后一页最后一条会回到有效页', () => {
  const rules = Array.from({ length: 21 }, (_, i) => rule({ id: 'r-' + i }));
  assert.deepEqual(skipRulePage(rules, 1).items, rules.slice(0, 10));
  assert.deepEqual(skipRulePage(rules, 2).items, rules.slice(10, 20));
  assert.equal(skipRulePage(rules, 3).items[0].id, 'r-20');
  assert.equal(skipRulePage(rules.slice(0, 20), 3).page, 2);
  assert.deepEqual(skipRulePage([], 5), { items: [], page: 1, pages: 1, total: 0 });
});

test('统一跳过方式：按位置与按时长使用同一对片头片尾字段，按实际视频时长换算', () => {
  const position = rule({ mode: 'position', intro: 175, outro: 620 });
  const duration = rule({ mode: 'duration', intro: 175, outro: 120 });
  for (const r of [position, duration]) assert.equal(skipDecision(settings(), r, { position: 0, duration: 752 }).target, 175);
  assert.equal(skipDecision(settings(), position, { position: 619, duration: 752 }), null);
  assert.equal(skipDecision(settings(), position, { position: 620, duration: 752 }).kind, 'outro');
  assert.equal(skipDecision(settings(), duration, { position: 631, duration: 752 }), null);
  assert.equal(skipDecision(settings(), duration, { position: 632, duration: 752 }).kind, 'outro');
  // The duration rule follows each episode's length, rather than fixing the old boundary.
  assert.equal(skipDecision(settings(), duration, { position: 632, duration: 900 }), null);
  assert.equal(skipDecision(settings(), duration, { position: 780, duration: 900 }).kind, 'outro');
});

test('保存规则拒绝相同/交叉位置、未知模式、缺少模式；服务端不依赖前端校验', async t => {
  const { store } = await fixture(t);
  for (const invalid of [rule({ mode: 'position', intro: 120, outro: 120 }), rule({ mode: 'position', intro: 200, outro: 120 }), rule({ mode: 'random' }), rule({ mode: undefined })]) {
    await assert.rejects(async () => store.update(settings({ rules: [invalid] })), { status: 400 });
  }
  assert.equal(store.get().revision, 0);
  await store.update(settings({ rules: [rule({ mode: 'position', intro: 0, outro: 120 })] }));
});

test('运行时校验两种方式的越界、交叉、等长和独立开关，避免跳过全部正片', () => {
  const r = rule({ mode: 'duration', intro: 90, outro: 120 });
  for (const length of [209, 210]) {
    const intro = skipDecision(settings(), r, { position: 0, duration: length });
    assert.equal(intro.kind, 'intro'); assert.match(intro.warning, /交叉/);
    assert.equal(skipDecision(settings(), r, { position: 100, duration: length }).kind, 'invalid');
  }
  assert.equal(skipDecision(settings(), r, { position: 91, duration: 211 }).kind, 'outro');
  const invalidTail = rule({ mode: 'position', intro: 90, outro: 900 });
  assert.equal(skipDecision(settings(), invalidTail, { position: 0, duration: 752 }).kind, 'intro');
  assert.match(skipDecision(settings(), invalidTail, { position: 100, duration: 752 }).warning, /片尾时间超出/);
  assert.equal(skipDecision(settings({ skipOutro: false }), invalidTail, { position: 100, duration: 752 }), null);
  assert.equal(skipDecision(settings({ skipIntro: false }), r, { position: 90, duration: 210 }).kind, 'outro');
  for (const length of [0, NaN, Infinity]) assert.equal(skipDecision(settings(), r, { position: 0, duration: length }), null);
});

test('旧片尾位置/倒数设置无损映射为整条规则的按位置/按时长方式', async t => {
  const { root } = await fixture(t); await mkdir(join(root, 'data'));
  const file = join(root, 'data/playback-settings.json');
  for (const [outroMode, expected] of [['position', 'position'], ['remaining', 'duration']]) {
    const legacy = { ...settings(), version: 2, rules: [{ ...rule(), mode: undefined, outroMode }] };
    await writeFile(file, JSON.stringify(legacy));
    const loaded = await openSkipSettings(root), migrated = loaded.get();
    assert.equal(migrated.version, 3); assert.equal(migrated.rules[0].mode, expected);
    assert.equal(migrated.rules[0].intro, 90); assert.equal(migrated.rules[0].outro, 120);
    assert.equal(migrated.rules[0].id, 'film-1'); assert.equal(migrated.rules[0].enabled, true);
    assert.equal(Object.hasOwn(migrated.rules[0], 'outroMode'), false);
    await loaded.update(migrated); assert.equal(JSON.parse(await readFile(file, 'utf8')).rules[0].mode, expected);
  }
});
