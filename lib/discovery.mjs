import { HttpError } from './util.mjs';
import { matchesFilm, normalizedTitle, qualityRank } from './matching.mjs';

function timeoutSignal(signal, milliseconds) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds);
}

export class Discovery {
  constructor(providers) { this.providers = providers; }
  async feed(configId, options, signal) {
    let candidates = this.providers.eligible(configId);
    if (options.skip) candidates = candidates.filter(s => s.id !== options.skip);
    if (options.source) {
      const selected = candidates.find(s => s.id === options.source);
      if (!selected) throw new HttpError(400, '展示源不属于当前配置。');
      candidates = [selected];
    } else {
      // Known HTTP libraries provide a fast starting page. Matching still searches JS/Python.
      candidates.sort((a,b) => (a.kind === 'http' ? -1 : 1) - (b.kind === 'http' ? -1 : 1));
    }
    let lastError;
    for (const candidate of candidates.slice(0,6)) {
      signal?.throwIfAborted();
      try {
        const childSignal = timeoutSignal(signal, 10_000);
        let categories = [];
        try { categories = await this.providers.getCategories(candidate.id, childSignal); } catch {}
        let category = options.category || '';
        if (!category && options.genre && options.genre !== 'all') {
          const patterns = { movie: /剧情片|电影|动作片/, tv: /国产剧|大陆剧|连续剧|电视剧|剧集/, anime: /日韩动漫|国产动漫|动漫|动画|少儿/ };
          const preferred = { movie: /剧情片/, tv: /国产剧|大陆剧/, anime: /日韩动漫/ };
          category = (categories.find(c => preferred[options.genre]?.test(c.name)) ||
            categories.find(c => patterns[options.genre]?.test(c.name)))?.id || '';
          if (!category) continue;
        }
        const result = await this.providers.catalog(candidate.id, { page: options.page, category }, childSignal);
        if (!result.list.length && !options.source) continue;
        return { ...result, config: configId, source: candidate.id, sourceName: candidate.name,
          categories, category, list: result.list.map(v => ({ ...v, source: candidate.id, sourceName: candidate.name,
            kind: candidate.kind, quality: candidate.quality })) };
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    throw new HttpError(502, lastError?.message || '当前配置暂时没有可展示的影视源，请换一个配置。');
  }

  stream(configId, query, target, excluded, signal, only = '') {
    let sources = this.providers.eligible(configId, true, excluded);
    if (only) sources = sources.filter(s => s.id === only);
    const encoder = new TextEncoder();
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const stream = new ReadableStream({
      start: async output => {
        const emit = value => { if (!combined.aborted) output.enqueue(encoder.encode(JSON.stringify(value) + '\n')); };
        let complete = 0, found = 0;
        try {
          emit({ type: 'start', total: sources.length });
          for (let offset = 0; offset < sources.length && !combined.aborted; offset += 3) {
            await Promise.allSettled(sources.slice(offset, offset + 3).map(async source => {
              try {
                const result = await this.providers.catalog(source.id, { q: query, page: 1 }, timeoutSignal(combined, 12_000));
                const list = (target ? result.list.filter(v => matchesFilm(v, target)) :
                  result.list.filter(v => normalizedTitle(v.title).includes(normalizedTitle(query)))).slice(0,30)
                  .map(v => ({ ...v, source: source.id, sourceName: source.name, kind: source.kind,
                    confidence: target && (!/(?:19|20)\d{2}/.test(v.year||'') || !/(?:19|20)\d{2}/.test(target.year||'')) ? 'title-only' : 'verified-metadata',
                    quality: qualityRank(source.name) >= 40 ? '4K 标识' : '' }));
                found += list.length;
                emit({ type: 'results', source: source.id, sourceName: source.name, list });
              } catch (error) {
                if (!combined.aborted) emit({ type: 'source-error', source: source.id, sourceName: source.name,
                  message: error.message || '源访问超时' });
              } finally {
                complete++; emit({ type: 'progress', complete, total: sources.length, found });
              }
            }));
          }
          if (!combined.aborted) { emit({ type: 'done', complete, total: sources.length, found }); output.close(); }
        } catch (error) {
          if (!combined.aborted) { emit({ type: 'error', message: error.message }); output.close(); }
        }
      },
      cancel: () => controller.abort()
    });
    return new Response(stream, { headers: {
      'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store'
    } });
  }
}
