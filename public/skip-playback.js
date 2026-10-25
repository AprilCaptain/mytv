import { filmTitle } from './history-utils.js';

export function matchingSkipRule(settings, film) {
  if (!settings?.enabled || !film || film.direct) return null;
  const matches = settings.rules.filter(rule => rule.enabled && filmTitle(rule.title) === filmTitle(film.title));
  const specific = matches.filter(rule => rule.year && rule.year === String(film.year || ''));
  if (specific.length === 1) return specific[0];
  // An unknown year must not silently choose between several versions.
  if (!film.year && matches.some(rule => rule.year)) return null;
  return matches.find(rule => !rule.year) || null;
}
export function skipDecision(settings, rule, { position, duration, introDone, outroDone }) {
  if (!settings?.enabled || !rule?.enabled || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return null;
  const intro = settings.skipIntro ? rule.intro : 0, outro = settings.skipOutro ? rule.outro : 0;
  if (intro + outro >= duration) return { kind: 'invalid' };
  if (outro > 0 && !outroDone && position >= duration - outro) return { kind: 'outro', target: Math.max(0, duration - 0.05) };
  if (intro > 0 && !introDone && position < intro) return { kind: 'intro', target: intro };
  return null;
}

export function createSkipPlayback({ video, api, current, ready, notice }) {
  let settings = null, introDone = false, outroDone = false, invalidNotified = false, disposed = false;
  let refreshSerial = 0;
  async function refresh() {
    const serial = ++refreshSerial;
    try { const data = await api('/api/skip-settings'); if (!disposed && serial === refreshSerial) settings = data; }
    catch { if (!disposed && serial === refreshSerial) settings = null; }
  }
  function check() {
    if (disposed || !ready() || video.paused || video.seeking || video.ended || video.readyState < 3) return;
    const rule = matchingSkipRule(settings, current());
    const action = skipDecision(settings, rule, { position: video.currentTime, duration: video.duration, introDone, outroDone });
    if (rule && settings.skipIntro && video.currentTime >= rule.intro) introDone = true;
    if (!action) return;
    if (action.kind === 'invalid') {
      if (!invalidNotified) notice('跳过时间超出本集时长，本集未自动跳过。');
      invalidNotified = true; return;
    }
    let seekable = false;
    for (let i = 0; i < video.seekable.length; i++)
      if (action.target >= video.seekable.start(i) && action.target <= video.seekable.end(i)) seekable = true;
    if (!seekable) return;
    try { video.currentTime = action.target; }
    catch { return; }
    if (action.kind === 'intro') introDone = true; else outroDone = true;
    notice(action.kind === 'intro' ? '已跳过片头' : '已跳过片尾');
  }
  for (const event of ['timeupdate', 'playing', 'seeked', 'progress']) video.addEventListener(event, check);
  const timer = setInterval(() => { if (!video.paused) void refresh(); }, 10000);
  return { refresh, reset() { introDone = false; outroDone = false; invalidNotified = false; void refresh(); },
    dispose() { disposed = true; clearInterval(timer); for (const event of ['timeupdate', 'playing', 'seeked', 'progress']) video.removeEventListener(event, check); } };
}
