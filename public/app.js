'use strict';
const $ = id => document.getElementById(id);
const video = $('video');
const state = {
  configs: [], config: null, configUrl: '', configName: '电视', generation: 0,
  catalogSource: '', categories: [], genre: 'all', category: '', page: 1, pageCount: 1, q: '',
  groups: [], matches: [], target: null, current: null, line: 0, episode: 0,
  reverse: false, shown: 180, hls: null, mediaUrl: '', playSerial: 0, detailSerial: 0,
  autoAttempt: 0, autoMode: false, hasPlayed: false, userSource: false, failed: new Set(),
  controllers: {}, searching: false, matching: false
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href','#i-'+name); svg.append(use); svg.setAttribute('aria-hidden','true'); return svg;
}
function params(object) { return new URLSearchParams(object).toString(); }
function controller(name) { state.controllers[name]?.abort(); return state.controllers[name] = new AbortController(); }
function abort(name) { state.controllers[name]?.abort(); }
function textForm(id, text, error = false) { $(id).textContent = text; $(id).classList.toggle('error', error); }
function source(id) { return state.config?.sources.find(s => s.id === id); }
function metadataScore(item) { return (/(?:19|20)\d{2}/.test(item.year||'')?2:0)+(item.type?1:0); }
function uniqueSources(items) {
  const result=new Map();
  for(const item of items) {
    const previous=result.get(item.source);
    if(!previous||metadataScore(item)>metadataScore(previous))result.set(item.source,item);
  }
  return [...result.values()];
}
function rank(name = '') { return /4k|2160p|uhd/i.test(name) ? 40 : /蓝光|原画|1080p/i.test(name) ? 20 : /720p|高清/i.test(name) ? 10 : 0; }
function titleKey(name = '') {
  return String(name).normalize('NFKC').toLowerCase()
    .replace(/[\[(【]\s*(?:4k|2160p|1080p|uhd|hdr|蓝光)\s*[\])】]/gi,'')
    .replace(/\s+(?:4k|2160p|uhd)$/gi,'').replace(/[\s\p{P}\p{S}]/gu,'');
}
function sameFilm(a,b) {
  if (titleKey(a.title) !== titleKey(b.title)) return false;
  const ay = String(a.year||'').match(/(?:19|20)\d{2}/)?.[0], by = String(b.year||'').match(/(?:19|20)\d{2}/)?.[0];
  if (ay && by && ay !== by) return false;
  const family = t => /动漫|动画/.test(t) ? 'anime' : /电影|片/.test(t) ? 'movie' : /剧|电视/.test(t) ? 'tv' : '';
  const af = family(a.type||''), bf = family(b.type||'');
  return !af || !bf || af === bf;
}
function episodeKey(name = '') {
  const normalized = String(name).normalize('NFKC').trim();
  const n = normalized.match(/^(?:第\s*)?0*(\d+)\s*(?:集|话|期)?(?:$|\s)/);
  return n ? 'number:'+Number(n[1]) : titleKey(normalized);
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options,
    headers: options.body ? {'content-type':'application/json'} : {},
    body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败，请重试。');
  return data;
}
async function stream(path, signal, onMessage) {
  const response = await fetch(path, {signal});
  if (!response.ok) { const data = await response.json(); throw new Error(data.error || '查找失败'); }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const {value,done} = await reader.read();
      if (done) break;
      pending += decoder.decode(value, {stream:true});
      let boundary;
      while ((boundary = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0,boundary); pending = pending.slice(boundary+1);
        if (line && !signal.aborted) onMessage(JSON.parse(line));
      }
    }
  } finally { await reader.cancel().catch(()=>{}); }
}
function loadingCards() {
  $('poster-grid').replaceChildren();
  for(let i=0;i<10;i++) {
    const item=element('div','skeleton'); item.setAttribute('aria-hidden','true');
    item.append(element('div','poster-wrap'),element('div','skeleton-title')); $('poster-grid').append(item);
  }
}
function catalogStatus(title,message,retry=true) {
  $('poster-grid').replaceChildren(); $('catalog-status').hidden=false;
  $('status-title').textContent=title; $('status-message').textContent=message;
  $('catalog-retry').hidden=!retry; $('pagination').hidden=true;
}
function renderConfigs() {
  $('config-list').replaceChildren(); $('config-dialog-list').replaceChildren();
  for(const config of state.configs) {
    const selected=config.url===state.configUrl;
    const button=element('button','config-item'+(selected?' selected':''),config.name);
    button.setAttribute('aria-pressed',String(selected));
    button.addEventListener('click',()=>selectConfig(config));
    $('config-list').append(button);
    const row=element('button','source-row'+(selected?' selected':''));
    row.append(element('span','',config.name),element('small','',selected?'当前配置':'选择'),icon('chevron'));
    row.addEventListener('click',()=>{ $('configs-dialog').close(); selectConfig(config); });
    $('config-dialog-list').append(row);
  }
  $('config-name').textContent=state.configName;
  const total=state.config?.sources.filter(s=>s.supported&&s.playable).length || 0;
  $('config-summary').textContent=state.config ? total+' 个可尝试观影片源' : '正在读取配置…';
  $('source-count').textContent=state.config ? state.configName+' · '+total+' 个观影片源' : '正在读取配置…';
}
async function selectConfig(config) {
  for(const key of Object.keys(state.controllers)) abort(key);
  goHome(); state.generation++;
  const generation=state.generation, ctrl=controller('config');
  state.config=null; state.configUrl=config.url; state.configName=config.name;
  state.catalogSource=''; state.categories=[]; state.category=''; state.genre='all'; state.q=''; state.page=1;
  state.groups=[]; $('search-input').value=''; $('config-url').value=config.url;
  $('config-summary').textContent='正在读取配置…'; renderConfigs(); renderCategories(); loadingCards();
  $('catalog-status').hidden=true; $('pagination').hidden=true; $('search-progress').hidden=true;
  $('clear-search').hidden=true; $('result-count').textContent='正在读取 '+config.name+' 的片源…';
  textForm('config-message','正在导入…');
  try {
    const result=await api('/api/config',{method:'POST',body:{url:config.url},signal:ctrl.signal});
    if(ctrl.signal.aborted||generation!==state.generation)return;
    state.config=result; renderConfigs();
    textForm('config-message','已读取 '+result.sources.length+' 个片源，其中 '+result.supported+' 个可接入本机运行环境。');
    await loadCatalog();
  } catch(error) {
    if(ctrl.signal.aborted)return;
    textForm('config-message',error.message,true); $('source-count').textContent='配置读取失败';
    $('config-summary').textContent='暂时无法读取'; $('result-count').textContent=config.name+' · 读取失败';
    catalogStatus('这个配置暂时无法读取',error.message+' 可以在侧边选择其他配置。');
  }
}
function renderCategories() {
  $('category-chips').replaceChildren();
  for(const [id,name] of [['all','全部'],['movie','电影'],['tv','剧集'],['anime','动漫']]) {
    const selected=state.genre===id;
    const button=element('button','chip'+(selected?' selected':''),name);
    button.setAttribute('aria-pressed',String(selected));
    button.addEventListener('click',()=>{ state.genre=id; state.category='';state.page=1;state.q='';
      $('search-input').value='';renderCategories();loadCatalog();});
    $('category-chips').append(button);
  }
  $('category-select').replaceChildren();
  const option=element('option','','更多分类');option.value='';$('category-select').append(option);
  for(const category of state.categories) { const item=element('option','',category.name);item.value=category.id;$('category-select').append(item); }
  $('category-select').hidden=!state.categories.length; $('category-select').value=state.category;
}
function mergeGroup(item) {
  let group=state.groups.find(g=>sameFilm(g,item));
  if(!group) {if(state.groups.length>=200)return;group={...item,candidates:[]};state.groups.push(group);}
  group.candidates=uniqueSources([...group.candidates,item]);
  group.candidates.sort((a,b)=>rank(b.sourceName)-rank(a.sourceName));
  if(!group.poster&&item.poster)group.poster=item.poster;
  if(!group.year&&item.year)group.year=item.year;
}
function posterCard(group) {
  const button=element('button','poster-card'),wrap=element('span','poster-wrap'),image=element('img');
  image.src=group.poster||'/placeholder.svg';image.alt='';image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';
  image.addEventListener('error',()=>{image.src='/placeholder.svg';},{once:true});
  const play=element('span','poster-play');play.append(icon('play'));
  wrap.append(image,element('span','poster-gradient'),element('span','poster-badge',group.remarks),play);
  if(group.candidates.some(c=>rank(c.sourceName)>=40))wrap.append(element('span','quality-badge','4K 标识'));
  const meta=[group.year,group.type,group.candidates.length>1?group.candidates.length+' 个匹配源':group.candidates[0]?.sourceName].filter(Boolean).join(' · ');
  button.append(wrap,element('span','poster-title',group.title),element('span','poster-meta',meta));
  button.addEventListener('click',()=>openGroup(group));return button;
}
function renderGroups() {
  $('catalog-status').hidden=true;
  $('poster-grid').replaceChildren(...state.groups.map(posterCard));
  if(state.q)$('result-count').textContent='找到 '+state.groups.length+' 部影片 · '+state.configName;
}
async function loadCatalog(skipSource='') {
  if(!state.config){await selectConfig({name:state.configName,url:state.configUrl});return;}
  if(state.q){await searchConfig();return;}
  abort('search');const ctrl=controller('catalog'),generation=state.generation;
  $('catalog-status').hidden=true;$('pagination').hidden=true;$('clear-search').hidden=true;
  $('search-progress').hidden=true;$('stop-search').hidden=true;$('refresh-library').hidden=false;
  $('catalog-title').textContent='看一部好故事.';$('catalog-caption').textContent='正在选择当前配置的片库…';
  $('result-count').textContent='正在获取影片…';loadingCards();
  try {
    const result=await api('/api/feed?'+params({config:state.config.id,source:skipSource?'':state.catalogSource,
      skip:skipSource,genre:state.genre,category:state.category,page:state.page}),{signal:ctrl.signal});
    if(ctrl.signal.aborted||generation!==state.generation)return;
    state.catalogSource=result.source;state.categories=result.categories;state.category=result.category;
    state.pageCount=result.pageCount;state.groups=[];result.list.forEach(mergeGroup);renderCategories();renderGroups();
    const genreName=state.categories.find(c=>c.id===state.category)?.name;
    $('catalog-caption').textContent='片库来自 '+result.sourceName+(genreName?' · '+genreName:'')+'。进入影片可切换同配置的其他片源。';
    $('result-count').textContent='共 '+result.total.toLocaleString()+' 部 · 第 '+result.page+' 页';
    if(!result.list.length)catalogStatus('这个分类暂无影片','可以选择其他分类或换一个片库。',false);
    else {
      $('pagination').hidden=result.pageCount<=1;$('page-indicator').textContent=result.page+' / '+result.pageCount;
      $('previous-page').disabled=result.page<=1;$('next-page').disabled=result.page>=result.pageCount;
    }
  } catch(error) {
    if(!ctrl.signal.aborted){$('result-count').textContent=state.configName+' · 暂时无法展示';catalogStatus('片库暂时无法访问',error.message);}
  }
}
async function searchConfig() {
  if(!state.config)return;
  abort('catalog');const ctrl=controller('search'),generation=state.generation;
  state.groups=[];state.searching=true;$('poster-grid').replaceChildren();$('catalog-status').hidden=true;
  $('pagination').hidden=true;$('clear-search').hidden=false;$('refresh-library').hidden=true;
  $('search-progress').hidden=false;$('stop-search').hidden=false;
  $('catalog-title').textContent='搜索「'+state.q+'」';
  $('catalog-caption').textContent='在「'+state.configName+'」配置中跨源查找。';
  $('search-progress').textContent='正在查找，有结果会立即展示…';$('result-count').textContent='正在搜索…';
  try {
    await stream('/api/search?'+params({config:state.config.id,q:state.q}),ctrl.signal,message=>{
      if(generation!==state.generation)return;
      if(message.type==='results'){message.list.forEach(mergeGroup);renderGroups();}
      if(message.type==='progress')$('search-progress').textContent='已查找 '+message.complete+' / '+message.total+' 个片源 · 找到 '+state.groups.length+' 部影片';
      if(message.type==='done')$('search-progress').textContent='查找完成 · '+message.complete+' 个片源 · '+state.groups.length+' 部影片（最多展示 200 部）';
      if(message.type==='error')throw new Error(message.message);
    });
    if(!ctrl.signal.aborted&&!state.groups.length)catalogStatus('没有找到这部影片','可以试试更短的片名，或切换另一个配置。',false);
  } catch(error){if(!ctrl.signal.aborted)catalogStatus('搜索暂时失败',error.message);}
  finally{if(generation===state.generation){state.searching=false;$('stop-search').hidden=true;}}
}
function stopPlayer() {
  state.playSerial++;abort('play');state.hls?.destroy();state.hls=null;state.mediaUrl='';
  video.pause();video.removeAttribute('src');video.load();
  $('video-placeholder').hidden=false;$('play-error').hidden=true;$('video-quality').textContent='';
}
function goHome() {
  abort('detail');abort('matches');abort('lookup');stopPlayer();state.current=null;state.target=null;
  state.matches=[];state.matching=false;state.detailSerial++;
  $('watch-view').hidden=true;$('browse-view').hidden=false;
  document.title='My TV · 看一部好故事';
  $('source-nav').disabled=false;
}
function playerStatus(text,kind=''){$('player-status').textContent=text;$('player-status').dataset.kind=kind;}
function currentEpisode(){return state.current?.lines[state.line]?.episodes[state.episode];}
function errorPlayback(message) {
  playerStatus('播放未成功','error');$('play-error-text').textContent=message;$('play-error').hidden=false;
}
function candidateRank(candidate){return rank(candidate.sourceName)+rank(candidate.quality||'');}
function renderMatchSources() {
  state.matches=uniqueSources(state.matches);
  $('watch-source-list').replaceChildren();
  state.matches.sort((a,b)=>candidateRank(b)-candidateRank(a));
  for(const candidate of state.matches) {
    const selected=state.current?.source===candidate.source;
    const button=element('button','choice'+(selected?' selected':''),candidate.sourceName);
    button.setAttribute('aria-pressed',String(selected));
    if(rank(candidate.sourceName)>=40)button.append(element('span','choice-tag','4K'));
    if(candidate.confidence==='title-only'){button.title='源缺少年份信息，切换后请核对版本。';button.append(element('span','choice-tag','待核对'));}
    button.addEventListener('click',()=>{state.userSource=true;loadCandidate(candidate,currentEpisode()?.name,false);});
    $('watch-source-list').append(button);
  }
}
function addMatch(candidate) {
  state.matches=uniqueSources([...state.matches,candidate]);
}
async function findMatches(only='') {
  if(!state.target||!state.config)return [];
  const name=only?'lookup':'matches',ctrl=controller(name),generation=state.generation,target={...state.target};
  const found=[];
  if(!only){state.matching=true;$('matching-status').textContent='正在查找同配置的其他片源…';}
  try {
    await stream('/api/matches?'+params({config:state.config.id,title:target.title,year:target.year||'',type:target.type||'',
      only,exclude:only?'':state.matches.map(c=>c.source).join(',')}),ctrl.signal,message=>{
      if(generation!==state.generation||!state.target||!sameFilm(target,state.target))return;
      if(message.type==='results'){
        for(const item of message.list){addMatch(item);found.push(item);}
        renderMatchSources();
        const preferred=state.matches.find(item=>candidateRank(item)>=40&&item.confidence!=='title-only');
        if(!only&&preferred&&!state.userSource&&!state.hasPlayed&&
          candidateRank(preferred)>candidateRank(state.pendingCandidate||{}))loadCandidate(preferred,currentEpisode()?.name,true);
      }
      if(message.type==='progress'&&!only)$('matching-status').textContent='已匹配 '+state.matches.length+' 个片源 · 查找 '+message.complete+' / '+message.total;
      if(message.type==='done'&&!only)$('matching-status').textContent='匹配完成 · '+state.matches.length+' 个片源。4K 标签以源提供的信息为准。';
    });
  } catch(error){if(!ctrl.signal.aborted&&!only)$('matching-status').textContent='部分片源未能完成匹配，可在管理源中单独查找。';}
  finally{if(!only&&generation===state.generation)state.matching=false;}
  return found;
}
async function openGroup(group) {
  abort('search');state.userSource=false;state.hasPlayed=false;state.autoAttempt=0;state.failed.clear();
  state.target={title:group.title,year:group.year,type:group.type};
  state.matches=[...group.candidates];state.reverse=false;state.shown=180;
  $('browse-view').hidden=true;$('watch-view').hidden=false;
  $('watch-title').textContent=group.title;$('watch-meta').textContent='';$('watch-actors').textContent='';
  $('watch-description').textContent='';$('line-list').replaceChildren();$('episode-list').replaceChildren();
  $('episode-count').textContent='';$('watch-source').textContent=state.configName;
  document.title=group.title+' · My TV';window.scrollTo({top:0});
  const candidate=[...state.matches].sort((a,b)=>candidateRank(b)-candidateRank(a))[0];
  renderMatchSources();
  const loading=loadCandidate(candidate,undefined,true);
  findMatches();
  await loading;
}
function lineRank(line) {return rank(line.name)*100+(line.episodes.some(ep=>ep.direct)?10:0);}
async function loadCandidate(candidate,preserveName,automatic=false) {
  if(!candidate)return;
  state.pendingCandidate=candidate;
  $('source-nav').disabled=false;
  const ctrl=controller('detail'),serial=++state.detailSerial;stopPlayer();
  playerStatus('正在加载 '+candidate.sourceName+'…');
  $('watch-source').textContent=state.configName+' / '+candidate.sourceName;
  try {
    const detail=await api('/api/detail?'+params({source:candidate.source,id:candidate.id}),{signal:ctrl.signal});
    if(ctrl.signal.aborted||serial!==state.detailSerial)return;
    if(state.target&&!sameFilm(detail,state.target))throw new Error('这个源返回了不同版本的影片，请选择其他片源。');
    addMatch({...candidate,year:detail.year||candidate.year,type:detail.type||candidate.type,
      confidence:/(?:19|20)\d{2}/.test(detail.year||'')?'verified-metadata':candidate.confidence});
    state.current={...detail,source:candidate.source,sourceName:candidate.sourceName,kind:candidate.kind,card:candidate};
    if(!detail.lines.length)throw new Error('这个片源没有提供线路。');
    state.line=detail.lines.map((line,index)=>({index,score:lineRank(line)})).sort((a,b)=>b.score-a.score)[0].index;
    const episodes=detail.lines[state.line].episodes;
    const matched=preserveName?episodes.findIndex(ep=>episodeKey(ep.name)===episodeKey(preserveName)):-1;
    state.episode=matched>=0?matched:0;state.shown=Math.max(180,Math.ceil((state.episode+1)/180)*180);
    $('watch-title').textContent=detail.title;
    $('watch-meta').textContent=[detail.year,detail.area,detail.type,detail.remarks].filter(Boolean).join(' · ');
    $('watch-actors').textContent=[detail.director?'导演：'+detail.director:'',detail.actors?'演员：'+detail.actors:''].filter(Boolean).join('　');
    $('watch-description').textContent=detail.description||'这个片源暂未提供简介。';
    renderMatchSources();renderLines();renderEpisodes();
    await playEpisode(state.episode,automatic);
  } catch(error){if(!ctrl.signal.aborted&&serial===state.detailSerial){errorPlayback(error.message);if(automatic)autoFallback();}}
}
function renderLines() {
  $('line-list').replaceChildren();
  const lines=state.current?.lines||[];
  lines.map((line,index)=>({line,index})).sort((a,b)=>lineRank(b.line)-lineRank(a.line)).forEach(({line,index})=>{
    const button=element('button','choice'+(state.line===index?' selected':''),line.name);
    button.setAttribute('aria-pressed',String(state.line===index));
    if(rank(line.name)>=40)button.append(element('span','choice-tag','4K'));
    button.addEventListener('click',()=>{
      const old=currentEpisode()?.name;state.line=index;
      const matched=line.episodes.findIndex(ep=>episodeKey(ep.name)===episodeKey(old||''));
      state.episode=matched>=0?matched:Math.min(state.episode,line.episodes.length-1);
      state.autoAttempt=0;renderLines();playEpisode(Math.max(0,state.episode),false);
    });
    $('line-list').append(button);
  });
  $('line-hint').textContent='优先选择有 4K 标识的线路；播放失败可换线或换源。';
}
function renderEpisodes() {
  const episodes=state.current?.lines[state.line]?.episodes||[];
  $('episode-list').replaceChildren();
  const indices=episodes.map((_ep,i)=>i);if(state.reverse)indices.reverse();
  indices.slice(0,state.shown).forEach(index=>{
    const ep=episodes[index],selected=state.episode===index;
    const button=element('button','episode-button'+(selected?' selected':''),ep.name);
    button.title=ep.name;button.setAttribute('aria-pressed',String(selected));
    button.addEventListener('click',()=>{state.autoAttempt=0;playEpisode(index,false);});
    $('episode-list').append(button);
  });
  $('episode-count').textContent=episodes.length+' 集';
  $('next-episode').disabled=!episodes.length||state.episode>=episodes.length-1;
  $('episode-order').textContent=state.reverse?'正序':'倒序';
  $('more-episodes').hidden=state.shown>=episodes.length;
}
async function playEpisode(index,automatic=false) {
  const current=state.current;if(!current||!current.lines[state.line]?.episodes[index])return;
  stopPlayer();state.episode=index;state.autoMode=automatic;
  const serial=state.playSerial,ctrl=controller('play');renderEpisodes();
  playerStatus('正在连接 · '+currentEpisode().name);
  try {
    const body=current.direct?{url:currentEpisode().url}:{config:state.config.id,source:current.source,id:current.id,line:state.line,episode:index};
    const result=await api('/api/play',{method:'POST',body,signal:ctrl.signal});
    if(ctrl.signal.aborted||serial!==state.playSerial)return;
    attachMedia(result,serial);
  } catch(error){if(!ctrl.signal.aborted&&serial===state.playSerial){errorPlayback(error.message);if(automatic)autoFallback();}}
}
function autoFallback() {
  if(!state.current||state.current.direct||!state.target||state.autoAttempt++>=3)return;
  const preserve=currentEpisode()?.name;
  state.failed.add(state.current.source+':'+state.line);
  const alternate=state.current.lines.map((line,index)=>({line,index})).sort((a,b)=>lineRank(b.line)-lineRank(a.line))
    .find(item=>!state.failed.has(state.current.source+':'+item.index));
  if(alternate) {
    state.line=alternate.index;
    const matched=alternate.line.episodes.findIndex(ep=>episodeKey(ep.name)===episodeKey(preserve||''));
    renderLines();playEpisode(matched>=0?matched:0,true);return;
  }
  const next=state.matches.find(candidate=>candidate.source!==state.current.source&&
    ![...state.failed].some(key=>key.startsWith(candidate.source+':')));
  if(next)loadCandidate(next,preserve,true);
}
function attachMedia(result,serial) {
  state.mediaUrl=result.url;$('video-placeholder').hidden=true;
  if(result.format==='hls'&&window.Hls?.isSupported()) {
    const hls=new Hls({enableWorker:true,maxBufferLength:25,maxMaxBufferLength:45,
      maxBufferSize:48*1024*1024,backBufferLength:15,manifestLoadingTimeOut:15000,fragLoadingTimeOut:20000});
    state.hls=hls;let recovery=0;
    hls.on(Hls.Events.MANIFEST_PARSED,()=>{
      if(serial!==state.playSerial)return;
      const choices=hls.levels.map((level,index)=>({index,height:level.height||0,bitrate:level.bitrate||0}))
        .sort((a,b)=>b.height-a.height||b.bitrate-a.bitrate);
      if(choices.length)hls.currentLevel=choices[0].index;
      video.play().catch(error=>{
        if(serial!==state.playSerial||error.name==='AbortError')return;
        if(error.name==='NotAllowedError')playerStatus('已就绪，点击播放器开始播放。');
        else errorPlayback('浏览器暂时无法播放，请换线或换源。');
      });
    });
    hls.on(Hls.Events.ERROR,(_event,data)=>{
      if(serial!==state.playSerial||!data.fatal)return;
      if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&recovery++===0){hls.recoverMediaError();return;}
      let message='这条线路暂时无法播放，请换线或换源。';
      try{message=JSON.parse(data.response?.data||data.response?.text).error||message;}catch{}
      errorPlayback(message);hls.destroy();if(state.hls===hls)state.hls=null;
      if(state.autoMode)autoFallback();
    });
    hls.loadSource(result.url);hls.attachMedia(video);
  } else if(result.format!=='hls'||video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src=result.url;video.play().catch(error=>{
      if(serial!==state.playSerial)return;
      if(error.name==='NotAllowedError')playerStatus('已就绪，点击播放器开始播放。');
      else if(error.name!=='AbortError')errorPlayback('浏览器无法解码这个视频，请换线或换源。');
    });
  } else errorPlayback('这个浏览器不支持 HLS，请使用 Chrome、Edge 或 Safari。');
}
function actualQuality() {
  const width=video.videoWidth,height=video.videoHeight;
  $('video-quality').textContent=width&&height?width+' × '+height+(width>=3800?' · 4K':''):'';
}
video.addEventListener('loadedmetadata',actualQuality);video.addEventListener('resize',actualQuality);
video.addEventListener('playing',()=>{if(!state.mediaUrl)return;state.hasPlayed=true;$('play-error').hidden=true;
  playerStatus('正在播放 · '+(currentEpisode()?.name||''),'playing');actualQuality();});
video.addEventListener('waiting',()=>{if(state.mediaUrl)playerStatus('正在缓冲…');});
video.addEventListener('pause',()=>{if(state.mediaUrl&&!video.ended&&$('play-error').hidden)playerStatus('已暂停');});
video.addEventListener('error',()=>{if(state.mediaUrl&&!state.hls){errorPlayback('浏览器无法播放这个视频，请换线或换源。');if(state.autoMode)autoFallback();}});
video.addEventListener('ended',()=>{if($('auto-next').checked&&!$('next-episode').disabled)playEpisode(state.episode+1,false);else playerStatus('本集已播放完毕');});

async function renderSourceManager() {
  if(!state.config)return;
  try{const data=await api('/api/config-state?'+params({config:state.config.id}));state.config=data;}catch{}
  $('supported-source-list').replaceChildren();$('unsupported-source-list').replaceChildren();
  const usable=state.config.sources.filter(s=>s.supported&&s.playable),other=state.config.sources.filter(s=>!s.supported||!s.playable);
  $('source-dialog-caption').textContent='「'+state.configName+'」中的 '+usable.length+' 个观影片源。按片名、年份和季数匹配；年份缺失的候选需要核对。';
  for(const entry of usable) {
    const matched=state.matches.find(c=>c.source===entry.id);
    const row=element('button','source-row'+(state.current?.source===entry.id?' selected':''));
    const label=entry.kind==='js'?'JS':entry.kind==='python'?'Python':entry.type===0?'XML':'JSON';
    row.append(element('span','',entry.name),element('small','',(matched?'已匹配 · ':entry.health?.status==='error'?'上次访问失败 · ':'')+label),icon('chevron'));
    row.title=entry.health?.message||entry.name;
    row.addEventListener('click',async()=>{
      if(!state.target)return;
      textForm('source-dialog-message','正在查找 '+entry.name+'…');
      const results=matched?[matched]:await findMatches(entry.id);
      if(results.length){$('sources-dialog').close();state.userSource=true;loadCandidate(results[0],currentEpisode()?.name,false);}
      else textForm('source-dialog-message','这个片源没有找到匹配版本，或当前无法访问。',true);
    });
    $('supported-source-list').append(row);
  }
  for(const entry of other) {
    const row=element('div','unsupported-row');
    row.append(element('span','',entry.name),element('small','',entry.reason||'非影视点播源'));
    $('unsupported-source-list').append(row);
  }
  const android4k=other.filter(s=>!s.supported&&rank(s.name)>=40).length;
  $('unsupported-details').hidden=!other.length;
  $('unsupported-summary').textContent=other.length+' 个其他或暂不支持的源'+(android4k?'（含 '+android4k+' 个 4K 标识源）':'');
}
for(const button of document.querySelectorAll('.dialog-close'))button.addEventListener('click',()=>button.closest('dialog').close());
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();
  if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();
});
$('home-nav').addEventListener('click',goHome);$('watch-back').addEventListener('click',goHome);
$('add-config').addEventListener('click',()=>$('configs-dialog').showModal());
$('status-configs').addEventListener('click',()=>$('configs-dialog').showModal());
$('config-form').addEventListener('submit',event=>{
  event.preventDefault();const url=$('config-url').value.trim();
  let config=state.configs.find(c=>c.url===url);
  if(!config){config={name:'自定义配置',url};state.configs.push(config);}
  $('configs-dialog').close();selectConfig(config);
});
$('source-nav').addEventListener('click',()=>{textForm('source-dialog-message','');$('sources-dialog').showModal();renderSourceManager();});
$('catalog-retry').addEventListener('click',()=>loadCatalog());
$('category-select').addEventListener('change',event=>{state.category=event.target.value;state.genre='all';state.page=1;state.q='';
  $('search-input').value='';renderCategories();loadCatalog();});
$('search-form').addEventListener('submit',event=>{event.preventDefault();state.q=$('search-input').value.trim();state.page=1;
  state.category='';state.genre='all';renderCategories();state.q?searchConfig():loadCatalog();});
$('stop-search').addEventListener('click',()=>{abort('search');$('search-progress').textContent='搜索已暂停 · 已找到 '+state.groups.length+' 部影片';$('stop-search').hidden=true;});
$('clear-search').addEventListener('click',()=>{abort('search');state.q='';state.page=1;$('search-input').value='';loadCatalog();});
$('refresh-library').addEventListener('click',()=>{const previous=state.catalogSource;state.catalogSource='';state.page=1;state.category='';loadCatalog(previous);});
$('previous-page').addEventListener('click',()=>{state.page--;loadCatalog();window.scrollTo({top:0});});
$('next-page').addEventListener('click',()=>{state.page++;loadCatalog();window.scrollTo({top:0});});
$('episode-order').addEventListener('click',()=>{state.reverse=!state.reverse;renderEpisodes();});
$('more-episodes').addEventListener('click',()=>{state.shown+=180;renderEpisodes();});
$('next-episode').addEventListener('click',()=>{state.autoAttempt=0;playEpisode(state.episode+1,false);});
$('play-retry').addEventListener('click',()=>{state.autoAttempt=0;playEpisode(state.episode,false);});
$('direct-nav').addEventListener('click',()=>$('direct-dialog').showModal());
$('direct-form').addEventListener('submit',event=>{
  event.preventDefault();const url=$('direct-url').value.trim();let parsed;
  try{parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error();}
  catch{textForm('direct-message','请输入有效的 HTTP / HTTPS 视频地址。',true);return;}
  goHome();$('direct-dialog').close();$('browse-view').hidden=true;$('watch-view').hidden=false;
  state.current={direct:true,title:'链接播放',sourceName:'直接播放',lines:[{name:'视频链接',episodes:[{name:'播放',url,direct:true}]}]};
  state.line=0;state.episode=0;$('watch-title').textContent='链接播放';$('watch-meta').textContent=parsed.hostname;
  $('watch-actors').textContent='';$('watch-description').textContent='直接打开的视频链接。';
  $('watch-source').textContent='直接播放';$('watch-source-list').replaceChildren();
  $('matching-status').textContent='';$('source-nav').disabled=true;
  renderLines();renderEpisodes();playEpisode(0,false);
});
window.addEventListener('pagehide',()=>{for(const key of Object.keys(state.controllers))abort(key);stopPlayer();});
async function initialize() {
  try {
    const data=await api('/api/configs');state.configs=data.configs;
    await selectConfig(state.configs.find(c=>c.default)||state.configs[0]);
  } catch(error) {catalogStatus('服务尚未就绪',error.message+' 如果刚更新过版本，请先重启本机服务。');}
}
initialize();
