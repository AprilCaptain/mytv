import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BUILTIN_CONFIGS } from '../lib/configs.mjs';

const json = async path => JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8'));
const origins = await json('docs/source-origins.json');

// Keep the maintenance ledger useful when a future change adds or moves a source.
test('来源台账覆盖所有内置配置、本地源及其真实接口，综合片库没有遗漏', async () => {
  assert.equal(origins.schemaVersion, 1);
  assert.deepEqual(origins.configurations.map(c => [c.name, c.url]), BUILTIN_CONFIGS.map(c => [c.name, c.url]));
  const selected = await json('configs/selected.json');
  const websites = await json('configs/websites.json');
  const library = await json('configs/library.json');
  const localSources = [...selected.sites, ...websites.sites];
  const definitions = sources => sources.map(s => [s.key, s.api]).sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(definitions(library.sites), definitions(localSources));
  assert.equal(new Set(origins.sources.map(s => s.key)).size, localSources.length);
  assert.deepEqual(origins.sources.map(s => [s.key, s.endpoint]).sort(([a], [b]) => a.localeCompare(b)), definitions(localSources));
  const references = new Set(origins.references.map(r => r.id));
  for (const source of origins.sources) {
    assert.ok(source.maintenanceUrls.length, source.key + ' 缺少复查入口');
    assert.ok(source.publisherEvidence, source.key + ' 缺少归属确定性说明');
    assert.ok(Object.hasOwn(source, 'originalAuthor'), source.key + ' 未说明原作者是否确认');
    assert.ok(source.notes, source.key + ' 缺少维护说明');
    for (const ref of source.discoveryReferenceIds) assert.ok(references.has(ref), ref);
    for (const file of source.localFiles) assert.ok((await json(file)).sites.some(s => s.key === source.key));
    if (source.adapterFile) await readFile(new URL('../' + source.adapterFile, import.meta.url));
  }
  for (const config of origins.configurations) {
    for (const ref of config.referenceIds || []) assert.ok(references.has(ref), ref);
    if (config.snapshot) await json('docs/' + config.snapshot);
  }
});

test('外部配置溯源快照只保存公开引用，不保存完整插件参数或凭证', async () => {
  const snapshot = await json('docs/source-origin-snapshot-2026-10-18.json');
  const remote = origins.configurations.filter(c => c.kind === 'remote_config');
  assert.deepEqual(snapshot.configurations.map(c => c.configUrl).sort(), remote.map(c => c.url).sort());
  for (const config of snapshot.configurations) {
    assert.equal(config.entries.length, config.totalDefinitions);
    assert.equal(Object.values(config.definitionKinds).reduce((sum, count) => sum + count, 0), config.totalDefinitions);
    for (const entry of config.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ['key', 'name', 'kind', 'apiReference', 'pluginClass', 'extReference', 'originalAuthor'].sort());
      for (const address of [entry.apiReference, entry.extReference].filter(Boolean)) {
        const url = new URL(address);
        assert.ok(['https:', 'http:'].includes(url.protocol));
        assert.equal(url.username + url.password + url.search + url.hash, '', '快照不能保存凭证或 URL 参数');
      }
      if (entry.pluginClass) assert.match(entry.pluginClass, /^csp_[\w]+$/);
    }
  }
});
