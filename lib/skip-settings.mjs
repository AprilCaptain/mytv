import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.mjs';
import { filmTitle } from '../public/history-utils.js';

export const defaultSkipSettings = () => ({ version: 2, revision: 0, enabled: false, skipIntro: true, skipOutro: true, rules: [] });
export function validateSkipSettings(value, { allowLegacy = false } = {}) {
  if (!value || (value.version !== 2 && !(allowLegacy && value.version === 1)) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      ['enabled','skipIntro','skipOutro'].some(key => typeof value[key] !== 'boolean') ||
      !Array.isArray(value.rules) || value.rules.length > 100) throw new HttpError(400, '跳过设置格式无效，最多保存 100 条规则。');
  const ids = new Set(), titles = new Set();
  const rules = value.rules.map(rule => {
    if (!rule || typeof rule.title !== 'string' || !rule.title.trim() || rule.title.length > 120 ||
        !['position','remaining'].includes(rule.outroMode ?? 'remaining') || typeof rule.enabled !== 'boolean' || typeof rule.year !== 'string' || !/^(?:19\d{2}|20\d{2})?$/.test(rule.year) ||
        ![rule.intro, rule.outro].every(n => Number.isInteger(n) && n >= 0 && n <= 7200) ||
        (rule.intro === 0 && rule.outro === 0) || typeof rule.id !== 'string' || !/^[\w-]{1,64}$/.test(rule.id))
      throw new HttpError(400, '请填写影片名和有效时间（0～120 分钟），片头与片尾不能同时为零。');
    const key = filmTitle(rule.title) + '|' + rule.year;
    if (!filmTitle(rule.title) || ids.has(rule.id) || titles.has(key)) throw new HttpError(400, '同一影片与年份只需保留一条规则。');
    ids.add(rule.id); titles.add(key);
    return { id: rule.id, title: rule.title.trim(), year: rule.year, enabled: rule.enabled, intro: rule.intro, outro: rule.outro, outroMode: rule.outroMode ?? 'remaining' };
  });
  return { version: 2, revision: value.revision, enabled: value.enabled, skipIntro: value.skipIntro, skipOutro: value.skipOutro, rules };
}
export async function openSkipSettings(root) {
  const file = join(root, 'data', 'playback-settings.json');
  let value;
  try { value = validateSkipSettings(JSON.parse(await readFile(file, 'utf8')), { allowLegacy: true }); }
  catch (error) {
    if (error.code === 'ENOENT') value = defaultSkipSettings();
    else throw new Error('片头片尾设置无法读取，请检查 data/playback-settings.json；原文件已保留：' + error.message);
  }
  let queue = Promise.resolve();
  return {
    get: () => structuredClone(value),
    update(input) {
      const next = validateSkipSettings(input);
      const operation = queue.then(async () => {
        if (next.revision !== value.revision) throw new HttpError(409, '设置已在其他窗口更新，请重新打开后再修改。');
        next.revision++;
        await mkdir(join(root, 'data'), { recursive: true });
        const temporary = file + '.' + randomUUID() + '.tmp';
        try { await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, file); }
        catch (error) { await unlink(temporary).catch(() => {}); throw new HttpError(500, '设置未保存，请检查 data 目录权限和磁盘空间。'); }
        value = next;
        return structuredClone(value);
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
}
