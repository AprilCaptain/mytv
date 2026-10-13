import { createPlayer } from './player.js';
import { createHistory } from './history-ui.js';
import { historyEpisode,filmFamily } from './history-utils.js';
const $ = id => document.getElementById(id);
const video = $('video');
let history;
const player = createPlayer(video, $('video-stage'),{onPlay:()=>history?.requestClaim(),onSeek:()=>history?.requestClaim()});
const state = {
  configs: [], config: null, configUrl: '', configName: '电视', generation: 0,
  catalogSource: '', categories: [], genre: 'all', category: '', page: 1, pageCount: 1, q: '',
  groups: [], searchSources: new Map(), searchFilter: 'all', current: null, line: 0, episode: 0,
  reverse: false, shown: 180, hls: null, mediaUrl: '', playSerial: 0, detailSerial: 0,
  autoAttempt: 0, autoMode: false, failed: new Set(),
  controllers: {}, searching: false
};
history=createHistory({api,video,resume:resumeHistory,onFailure:errorPlayback});
state.historyRecord=null;state.recovering=false;
state.resumeFailedSources=new Set();

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
function stopSearchRequests() { abort('search');for(const key of Object.keys(state.controllers))if(key.startsWith('more-'))abort(key); }
function textForm(id, text, error = false) { $(id).textContent = text; $(id).classList.toggle('error', error); }
function rank(name = '') { return /4k|2160p|uhd/i.test(name) ? 40 : /蓝光|原画|1080p/i.test(name) ? 20 : /720p|高清/i.test(name) ? 10 : 0; }
function titleKey(name = '') {
  return String(name).normalize('NFKC').toLowerCase()
    .replace(/[\[(【]\s*(?:4k|2160p|1080p|uhd|hdr|蓝光)\s*[\])】]/gi,'')
    .replace(/\s+(?:4k|2160p|uhd)$/gi,'').replace(/[\s\p{P}\p{S}]/gu,'');
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
  $('poster-grid').hidden=false;$('search-results').hidden=true;$('search-source-filters').hidden=true;
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
  $('config-select').replaceChildren(); $('config-dialog-list').replaceChildren();
  for(const config of state.configs) {
    const selected=config.url===state.configUrl;
    const option=element('option','',config.name);option.value=config.url;option.selected=selected;
    $('config-select').append(option);
    const row=element('button','source-row'+(selected?' selected':''));
    row.append(element('span','',config.name),element('small','',selected?'当前配置':'选择'),icon('chevron'));
    row.addEventListener('click',()=>{ $('configs-dialog').close(); selectConfig(config).then(afterHistoryConfig); });
    $('config-dialog-list').append(row);
  }
  $('config-name').textContent=state.configName;
  const total=state.config?.sources.filter(s=>s.supported&&s.playable).length || 0;
  $('config-summary').textContent=state.config ? total+' 个可尝试观影片源' : '正在读取配置…';
  $('source-count').textContent=state.config ? state.configName+' · '+total+' 个观影片源' : '正在读取配置…';
}
async function selectConfig(config,initial=false) {
  if(!initial){for(const key of Object.keys(state.controllers)) abort(key);goHome();}
  state.generation++;
  const generation=state.generation, ctrl=controller('config');
  state.config=null; state.configUrl=config.url; state.configName=config.name;
  $('config-reference').href=config.reference||'https://github.com/qist/tvbox#readme';
  $('config-reference').textContent=config.reference?'查看片源验证记录 ↗':'查看配置来源 ↗';
  $('config-alternative').hidden=true;$('config-alternative').onclick=null;
  state.catalogSource=''; state.categories=[]; state.category=''; state.genre='all'; state.q=''; state.page=1;
  state.groups=[];state.searchSources=new Map();$('search-input').value=''; $('config-url').value=config.url;
  $('catalog-title').textContent='看一部好故事.';$('catalog-caption').textContent='正在读取「'+config.name+'」的片库…';$('filter-row').hidden=false;
  $('config-summary').textContent='正在读取配置…'; renderConfigs(); renderCategories(); loadingCards();
  $('catalog-status').hidden=true; $('pagination').hidden=true; $('search-progress').hidden=true;
  $('clear-search').hidden=true; $('result-count').textContent='正在读取 '+config.name+' 的片源…';
  textForm('config-message','正在导入…');
  try {
    const result=await api('/api/config',{method:'POST',body:{url:config.url},signal:ctrl.signal});
    if(ctrl.signal.aborted||generation!==state.generation)return;
    state.config=result; renderConfigs();
    textForm('config-message','已读取 '+result.sources.length+' 个片源，其中 '+result.supported+' 个可接入本机运行环境。'+(result.encodings?.length?' 已识别编码配置。':'')+(result.checkedAt?' 抽样检查日期：'+result.checkedAt+'，各影片清晰度可能不同。':''));
    await loadCatalog();
  } catch(error) {
    if(ctrl.signal.aborted)return;
    textForm('config-message',error.message,true); $('source-count').textContent='配置读取失败';
    $('config-summary').textContent='暂时无法读取'; $('result-count').textContent=config.name+' · 读取失败';
    catalogStatus('这个配置暂时无法读取',error.message+' 可以在侧边选择其他配置。');
    const alternative=state.configs.find(item=>item.url===config.fallbackUrl);
    if(alternative){$('config-alternative').textContent='读取 '+alternative.name+' 备用配置';$('config-alternative').hidden=false;$('config-alternative').onclick=()=>selectConfig(alternative);}
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
function posterCard(item) {
  const button=element('button','poster-card'),wrap=element('span','poster-wrap'),image=element('img');
  image.src=item.poster||'/placeholder.svg';image.alt='';image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';
  image.addEventListener('error',()=>{image.src='/placeholder.svg';},{once:true});
  const play=element('span','poster-play');play.append(icon('play'));
  wrap.append(image,element('span','poster-gradient'),element('span','poster-badge',item.remarks),play);
  wrap.append(element('span','poster-origin',item.sourceName));
  if(rank(item.sourceName)>=40){wrap.classList.add('source-4k');wrap.append(element('span','quality-badge','4K 标识'));}
  button.append(wrap,element('span','poster-title',item.title),element('span','poster-meta',[item.year,item.type].filter(Boolean).join(' · ')));
  button.setAttribute('aria-label',item.title+' · '+item.sourceName);
  button.addEventListener('click',()=>openMovie(item));return button;
}
function renderGroups() {
  $('catalog-status').hidden=true;$('poster-grid').hidden=false;$('search-results').hidden=true;
  $('poster-grid').replaceChildren(...state.groups.map(posterCard));
}
function searchCount() {return [...state.searchSources.values()].reduce((sum,result)=>sum+result.items.size,0);}
function showSearchSource(id) {
  state.searchFilter=id;
  state.searchAllGrid.hidden=id!=='all';
  for(const result of state.searchSources.values())if(result.section) {
    result.section.hidden=id==='all'||id!==result.id;
    (id==='all'?state.searchAllGrid:result.grid).append(...result.cards);
  }
}
function renderSearchFilters() {
  const available=[...state.searchSources.values()].filter(result=>result.items.size);
  const choices=[{id:'all',name:'全部片源',count:searchCount()},...available.map(result=>({id:result.id,name:result.name,count:result.items.size}))];
  $('search-source-filters').replaceChildren();
  for(const choice of choices) {
    const button=element('button','source-filter'+(state.searchFilter===choice.id?' selected':''),choice.name+' · '+choice.count);
    button.setAttribute('aria-pressed',String(state.searchFilter===choice.id));
    button.addEventListener('click',()=>{
      showSearchSource(choice.id);renderSearchFilters();
    });
    $('search-source-filters').append(button);
  }
  $('search-source-filters').hidden=!available.length;
  $('result-count').textContent='找到 '+searchCount()+' 条结果 · '+available.length+' 个片源';
}
function addSearchResults(message) {
  let result=state.searchSources.get(message.source);
  if(!result){result={id:message.source,name:message.sourceName,items:new Map(),cards:[],page:0,pageCount:1};state.searchSources.set(result.id,result);}
  const previousPage=result.page;
  result.page=message.page||result.page||1;result.pageCount=message.pageCount||result.page;
  const added=[];
  for(const item of message.list)if(!result.items.has(String(item.id))){result.items.set(String(item.id),item);added.push(item);}
  if(result.page>previousPage)result.exhausted=previousPage>0&&!added.length;
  if(!result.items.size)return;
  if(!result.section) {
    result.section=element('section','source-results');result.section.dataset.source=result.id;
    const heading=element('div','source-results-heading');result.heading=element('h2','',result.name);result.count=element('span','');
    heading.append(result.heading,result.count);result.grid=element('div','poster-grid');result.grid.setAttribute('aria-label',result.name+' 搜索结果');
    result.more=element('button','button secondary source-load-more','加载更多');result.more.addEventListener('click',()=>loadMoreSource(result));
    result.message=element('p','source-results-message');result.message.setAttribute('role','status');
    result.section.append(heading,result.grid,result.more,result.message);$('search-results').append(result.section);
  }
  const cards=added.map(posterCard);result.cards.push(...cards);
  (state.searchFilter==='all'?state.searchAllGrid:result.grid).append(...cards);result.count.textContent=result.items.size+' 条结果';
  result.more.hidden=result.exhausted||result.page>=result.pageCount||!message.list.length;
  result.section.hidden=state.searchFilter==='all'||state.searchFilter!==result.id;
  $('catalog-status').hidden=true;renderSearchFilters();
}
async function loadMoreSource(result) {
  const query=state.q,ctrl=controller('more-'+result.id),generation=state.generation;
  result.more.disabled=true;result.message.textContent='正在加载…';
  try {
    await stream('/api/search?'+params({config:state.config.id,q:query,only:result.id,page:result.page+1}),ctrl.signal,message=>{
      if(generation!==state.generation||state.q!==query)return;
      if(message.type==='results'){addSearchResults(message);result.message.textContent=result.exhausted||!message.list.length?'没有更多匹配结果。':'';}
      if(message.type==='source-error')throw new Error(message.message);
    });
    if(!ctrl.signal.aborted&&result.message.textContent==='正在加载…')result.message.textContent='';
  } catch(error){if(!ctrl.signal.aborted)result.message.textContent=error.message;}
  finally {result.more.disabled=false;}
}
async function loadCatalog(skipSource='') {
  if(!state.config){await selectConfig({name:state.configName,url:state.configUrl});return;}
  if(state.q){await searchConfig();return;}
  stopSearchRequests();state.searching=false;const ctrl=controller('catalog'),generation=state.generation;
  $('filter-row').hidden=false;
  $('catalog-status').hidden=true;$('pagination').hidden=true;$('clear-search').hidden=true;
  $('search-progress').hidden=true;$('stop-search').hidden=true;$('refresh-library').hidden=false;
  $('catalog-title').textContent='看一部好故事.';$('catalog-caption').textContent='正在选择当前配置的片库…';
  $('result-count').textContent='正在获取影片…';loadingCards();
  try {
    const result=await api('/api/feed?'+params({config:state.config.id,source:skipSource?'':state.catalogSource,
      skip:skipSource,genre:state.genre,category:state.category,page:state.page}),{signal:ctrl.signal});
    if(ctrl.signal.aborted||generation!==state.generation)return;
    state.catalogSource=result.source;state.categories=result.categories;state.category=result.category;
    state.pageCount=result.pageCount;state.groups=result.list;renderCategories();renderGroups();
    const genreName=state.categories.find(c=>c.id===state.category)?.name;
    $('catalog-caption').textContent='片库来自 '+result.sourceName+(genreName?' · '+genreName:'')+'。点击影片查看本片源的线路与选集。';
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
  for(const key of Object.keys(state.controllers))if(key.startsWith('more-'))abort(key);
  state.groups=[];state.searchSources=new Map();state.searchFilter='all';state.searching=true;
  $('poster-grid').replaceChildren();$('poster-grid').hidden=true;$('search-results').replaceChildren();$('search-results').hidden=false;
  state.searchAllGrid=element('div','poster-grid');state.searchAllGrid.setAttribute('aria-label','全部片源的搜索影片');$('search-results').append(state.searchAllGrid);
  $('filter-row').hidden=true;
  $('search-source-filters').hidden=true;$('catalog-status').hidden=true;
  $('pagination').hidden=true;$('clear-search').hidden=false;$('refresh-library').hidden=true;
  $('search-progress').hidden=false;$('stop-search').hidden=false;
  $('catalog-title').textContent='搜索「'+state.q+'」';
  $('catalog-caption').textContent='并行检索「'+state.configName+'」中的片源。选择片源可查看该源的结果和更多页。';
  $('search-progress').textContent='正在查找，有结果会立即展示…';$('result-count').textContent='正在搜索…';
  let errors=0;
  try {
    await stream('/api/search?'+params({config:state.config.id,q:state.q}),ctrl.signal,message=>{
      if(generation!==state.generation)return;
      if(message.type==='results')addSearchResults(message);
      if(message.type==='progress')$('search-progress').textContent='已查找 '+message.complete+' / '+message.total+' 个片源 · 找到 '+searchCount()+' 条结果';
      if(message.type==='source-error')errors++;
      if(message.type==='done'){$('search-progress').textContent='查找完成 · '+message.complete+' 个片源 · '+searchCount()+' 条结果'+(errors?' · '+errors+' 个源暂无法访问':'');renderSearchFilters();}
      if(message.type==='error')throw new Error(message.message);
    });
    if(!ctrl.signal.aborted&&!searchCount())catalogStatus('没有找到这部影片','可以试试更短的片名，或切换另一个配置。',false);
  } catch(error){if(!ctrl.signal.aborted)catalogStatus('搜索暂时失败',error.message);}
  finally{if(generation===state.generation&&state.controllers.search===ctrl){state.searching=false;$('stop-search').hidden=true;}}
}
function stopPlayer() {
  const saved=history.reset();
  state.playSerial++;abort('play');state.hls?.destroy();state.hls=null;state.mediaUrl='';
  video.pause();video.removeAttribute('src');video.load();
  player.reset();
  $('video-placeholder').hidden=false;$('play-error').hidden=true;$('video-quality').textContent='';
  return saved;
}
function goHome() {
  abort('detail');abort('history-resume');stopPlayer();state.current=null;state.detailSerial++;
  $('watch-view').hidden=true;$('browse-view').hidden=false;
  $('history-view').hidden=true;$('home-nav').classList.add('active');$('history-nav').classList.remove('active');void history.refresh();
  if(state.historyCatalogDirty){state.historyCatalogDirty=false;void loadCatalog();}
  document.title='My TV · 看一部好故事';
}
function playerStatus(text,kind=''){$('player-status').textContent=text;$('player-status').dataset.kind=kind;}
function currentEpisode(){return state.current?.lines[state.line]?.episodes[state.episode];}
function errorPlayback(message) {
  history.markFailed();
  playerStatus('播放未成功','error');$('play-error-text').textContent=message;$('play-error').hidden=false;
}
async function openMovie(item,restore=null) {
  state.historyRecord=restore?.record||null;state.recovering=false;
  if(!restore?.fallback)state.resumeFailedSources.clear();
  stopSearchRequests();state.current=null;state.autoAttempt=0;state.failed.clear();state.reverse=false;state.shown=180;
  if(state.searching)$('search-progress').textContent='搜索已暂停 · 已找到 '+searchCount()+' 条结果';
  $('browse-view').hidden=true;$('watch-view').hidden=false;
  $('history-view').hidden=true;
  $('watch-title').textContent=item.title;$('watch-meta').textContent='';$('watch-actors').textContent='';
  $('watch-description').textContent='';$('line-list').replaceChildren();$('episode-list').replaceChildren();
  $('episode-count').textContent='';$('watch-source').textContent=state.configName+' / '+item.sourceName;
  document.title=item.title+' · My TV';window.scrollTo({top:0});
  await loadCandidate(item,restore?.record?.episode?.name,true,restore);
}
function lineRank(line) {return rank(line.name)*100+(line.episodes.some(ep=>ep.direct)?10:0);}
async function loadCandidate(candidate,preserveName,automatic=false,restore=null) {
  if(!candidate)return;
  state.pendingCandidate=candidate;
  const ctrl=controller('detail'),serial=++state.detailSerial;stopPlayer();
  playerStatus('正在加载 '+candidate.sourceName+'…');
  $('watch-source').textContent=state.configName+' / '+candidate.sourceName;
  try {
    const detail=await api('/api/detail?'+params({source:candidate.source,id:candidate.id}),{signal:ctrl.signal});
    if(ctrl.signal.aborted||serial!==state.detailSerial)return;
    state.current={...detail,source:candidate.source,sourceName:candidate.sourceName,kind:candidate.kind,card:candidate};
    if(!detail.lines.length)throw new Error('这个片源没有提供线路。');
    state.line=detail.lines.map((line,index)=>({index,score:lineRank(line)})).sort((a,b)=>b.score-a.score)[0].index;
    const episodes=detail.lines[state.line].episodes;
    if(restore?.line!==undefined&&detail.lines[restore.line])state.line=restore.line;
    const activeEpisodes=detail.lines[state.line].episodes;
    const matched=preserveName?activeEpisodes.findIndex(ep=>historyEpisode(ep.name,detail.type)===historyEpisode(preserveName,detail.type)):-1;
    const missingEpisode=preserveName&&matched<0;
    state.episode=restore?.episode??(matched>=0?matched:0);
    const completed=restore?.record?.episode?.completed;
    const nextMissing=completed&&restore.record.episode.locator.hasNext&&state.episode>=activeEpisodes.length-1;
    if(completed&&filmFamily(detail.type)!=='movie'&&state.episode<activeEpisodes.length-1)state.episode++;
    state.shown=Math.max(180,Math.ceil((state.episode+1)/180)*180);
    $('watch-title').textContent=detail.title;
    $('watch-meta').textContent=[detail.year,detail.area,detail.type,detail.remarks].filter(Boolean).join(' · ');
    $('watch-actors').textContent=[detail.director?'导演：'+detail.director:'',detail.actors?'演员：'+detail.actors:''].filter(Boolean).join('　');
    $('watch-description').textContent=detail.description||'这个片源暂未提供简介。';
    renderLines();renderEpisodes();
    if(missingEpisode){errorPlayback('当前片源没有能对应历史的集数，请手动选择集数。');return;}
    if(nextMissing){errorPlayback('原集已看完，当前片源没有下一集。可手动选择重播或更换片源。');return;}
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
      const old=currentEpisode()?.name;history.save();
      const matched=line.episodes.findIndex(ep=>historyEpisode(ep.name,state.current.type)===historyEpisode(old||'',state.current.type));
      if(matched<0){stopPlayer();errorPlayback('这条线路没有可对应的同一集，请手动选择集数。');state.line=index;renderLines();renderEpisodes();return;}
      state.line=index;state.episode=matched;
      state.autoAttempt=0;state.failed.clear();renderLines();playEpisode(Math.max(0,state.episode),false);
    });
    $('line-list').append(button);
  });
  $('line-hint').textContent='优先选择有 4K 标识的线路；播放失败可以切换线路，或返回搜索选择其他片源。';
}
function renderEpisodes() {
  const episodes=state.current?.lines[state.line]?.episodes||[];
  $('episode-list').replaceChildren();
  const indices=episodes.map((_ep,i)=>i);if(state.reverse)indices.reverse();
  indices.slice(0,state.shown).forEach(index=>{
    const ep=episodes[index],selected=state.episode===index;
    const button=element('button','episode-button'+(selected?' selected':''),ep.name);
    button.title=ep.name;button.setAttribute('aria-pressed',String(selected));
    button.addEventListener('click',()=>{state.autoAttempt=0;state.failed.clear();playEpisode(index,false);});
    $('episode-list').append(button);
  });
  $('episode-count').textContent=episodes.length+' 集';
  $('next-episode').disabled=!episodes.length||state.episode>=episodes.length-1;
  $('episode-order').textContent=state.reverse?'正序':'倒序';
  $('more-episodes').hidden=state.shown>=episodes.length;
}
async function playEpisode(index,automatic=false) {
  const current=state.current;if(!current||!current.lines[state.line]?.episodes[index])return;
  const saved=stopPlayer();state.episode=index;state.autoMode=automatic;
  const serial=state.playSerial,ctrl=controller('play');renderEpisodes();
  playerStatus('正在连接 · '+currentEpisode().name);
  try {
    await saved;if(ctrl.signal.aborted||serial!==state.playSerial)return;
    const body=current.direct?{url:currentEpisode().url}:{config:state.config.id,source:current.source,id:current.id,line:state.line,episode:index};
    const prepared=await history.prepare({...body,configName:state.configName},state.historyRecord?.id);
    if(ctrl.signal.aborted||serial!==state.playSerial)return;
    if(!prepared){errorPlayback('已取消播放，原进度已保留。可重试或返回历史。');return;}
    const result=await api('/api/play',{method:'POST',body,signal:ctrl.signal});
    if(ctrl.signal.aborted||serial!==state.playSerial)return;
    attachMedia(result,serial);
  } catch(error){if(!ctrl.signal.aborted&&serial===state.playSerial){errorPlayback(error.message);if(automatic)autoFallback();}}
}
function autoFallback() {
  if(!state.current){if(state.historyRecord&&!state.recovering){state.recovering=true;void recoverSource();}return;}
  if(state.current.direct)return;
  const preserve=currentEpisode()?.name;
  state.failed.add(state.current.source+':'+state.line);
  const alternate=state.current.lines.map((line,index)=>({line,index})).sort((a,b)=>lineRank(b.line)-lineRank(a.line))
    .find(item=>!state.failed.has(state.current.source+':'+item.index));
  if(alternate&&state.autoAttempt++<2) {
    state.line=alternate.index;
    const matched=alternate.line.episodes.findIndex(ep=>historyEpisode(ep.name,state.current.type)===historyEpisode(preserve||'',state.current.type));
    if(matched>=0){renderLines();playEpisode(matched,true);return;}
    state.failed.add(state.current.source+':'+alternate.index);autoFallback();return;
  }
  if(!state.recovering&&state.historyRecord){state.recovering=true;void recoverSource();}
}
async function adoptHistoryConfig(config,record){
  abort('config');abort('catalog');stopSearchRequests();state.generation++;
  if(state.configUrl!==config.url){state.historyCatalogDirty=true;state.catalogSource='';state.category='';state.genre='all';state.categories=[];state.page=1;state.q='';$('search-input').value='';}
  state.config=config;state.configUrl=config.url;state.configName=record.episode.locator.configName||'历史配置';
  if(!state.configs.some(c=>c.url===config.url))state.configs.push({name:state.configName,url:config.url});
  renderConfigs();$('config-name').textContent=state.configName;
  const count=config.sources.filter(s=>s.supported&&s.playable).length;$('config-summary').textContent=count+' 个可尝试观影片源';$('source-count').textContent=state.configName+' · '+count+' 个观影片源';
}
async function historyCandidates(result){
  const token=state.detailSerial;
  if(result.candidate)return result.candidate;
  if(result.candidates?.length){const value=await history.choose('选择续播片源',result.error||'请核对影片版本和集数。',result.candidates.map((c,i)=>({label:c.title+' · '+c.sourceName+' · '+(c.year||''),value:i})));
    if(token!==state.detailSerial)return null;if(value!==null)return result.candidates[value];}
  const change=await history.choose('原播放入口不可用',result.error||'可以更换配置寻找同片，原进度会保留。',[{label:'更换配置寻找',value:true},{label:'返回历史',value:false}]);
  if(token!==state.detailSerial)return null;
  if(change){showHistory();state.pendingHistory=result.record;$('configs-dialog').showModal();}else showHistory();return null;
}
async function recoverSource(){
  const ctrl=controller('history-resume'),record=state.historyRecord;
  const failed=state.current?.source||state.pendingCandidate?.source;if(failed)state.resumeFailedSources.add(failed);
  try{const result=await api('/api/history/matches',{method:'POST',body:{id:record.id,config:state.config.id,exclude:[...state.resumeFailedSources]},signal:ctrl.signal});
    if(ctrl.signal.aborted)return;
    result.record=state.historyRecord;const candidate=await historyCandidates(result);if(candidate)await openMovie(candidate,{record:result.record,fallback:true});
  }catch(e){errorPlayback(e.message);}
}
async function resumeHistory(id){
  goHome();playerStatus('正在恢复历史…');
  const ctrl=controller('history-resume');
  try{const result=await api('/api/history/resume',{method:'POST',body:{id},signal:ctrl.signal});if(ctrl.signal.aborted)return;
    if(result.directUrl){openDirect(result.directUrl,result.record);return;}
    if(result.config)await adoptHistoryConfig(result.config,result.record);
    const candidate=await historyCandidates(result);if(candidate)await openMovie(candidate,{...result,record:result.record});
  }catch(e){if(!ctrl.signal.aborted){showHistory();$('history-message').textContent=e.message;}}
}
function showHistory(){goHome();$('browse-view').hidden=true;$('history-view').hidden=false;$('home-nav').classList.remove('active');$('history-nav').classList.add('active');document.title='观看历史 · My TV';void history.refresh();}
function attachMedia(result,serial) {
  state.mediaUrl=result.url;$('video-placeholder').hidden=true;
  if(result.format==='hls'&&window.Hls?.isSupported()) {
    const hls=new window.Hls({enableWorker:true,maxBufferLength:25,maxMaxBufferLength:45,
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
        else errorPlayback('浏览器暂时无法播放，请切换线路，或返回搜索选择其他片源。');
      });
    });
    hls.on(Hls.Events.ERROR,(_event,data)=>{
      if(serial!==state.playSerial||!data.fatal)return;
      if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&recovery++===0){hls.recoverMediaError();return;}
      let message='这条线路暂时无法播放，请切换线路，或返回搜索选择其他片源。';
      try{message=JSON.parse(data.response?.data||data.response?.text).error||message;}catch{}
      errorPlayback(message);hls.destroy();if(state.hls===hls)state.hls=null;
      if(state.autoMode)autoFallback();
    });
    hls.loadSource(result.url);hls.attachMedia(video);
  } else if(result.format!=='hls'||video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src=result.url;video.play().catch(error=>{
      if(serial!==state.playSerial)return;
      if(error.name==='NotAllowedError')playerStatus('已就绪，点击播放器开始播放。');
      else if(error.name!=='AbortError')errorPlayback('浏览器无法解码这个视频，请切换线路，或返回搜索选择其他片源。');
    });
  } else errorPlayback('这个浏览器不支持 HLS，请使用 Chrome、Edge 或 Safari。');
}
function actualQuality() {
  const width=video.videoWidth,height=video.videoHeight;
  $('video-quality').textContent=width&&height?width+' × '+height+(width>=3800?' · 4K':''):'';
}
video.addEventListener('loadedmetadata',actualQuality);video.addEventListener('resize',actualQuality);
video.addEventListener('playing',()=>{if(!state.mediaUrl)return;$('play-error').hidden=true;
  playerStatus('正在播放 · '+(currentEpisode()?.name||''),'playing');actualQuality();});
video.addEventListener('waiting',()=>{if(state.mediaUrl)playerStatus('正在缓冲…');});
video.addEventListener('pause',()=>{if(state.mediaUrl&&!video.ended&&$('play-error').hidden)playerStatus('已暂停');});
video.addEventListener('error',()=>{if(state.mediaUrl&&!state.hls){errorPlayback('浏览器无法播放这个视频，请切换线路，或返回搜索选择其他片源。');if(state.autoMode)autoFallback();}});
video.addEventListener('ended',()=>{if($('auto-next').checked&&!$('next-episode').disabled)playEpisode(state.episode+1,false);else playerStatus('本集已播放完毕');});

for(const button of document.querySelectorAll('.dialog-close'))button.addEventListener('click',()=>button.closest('dialog').close());
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();
  if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();
});
$('home-nav').addEventListener('click',goHome);$('watch-back').addEventListener('click',goHome);
$('history-nav').addEventListener('click',showHistory);$('all-history').addEventListener('click',showHistory);$('history-back').addEventListener('click',goHome);
function afterHistoryConfig(){if(state.pendingHistory&&state.config){state.historyRecord=state.pendingHistory;state.pendingHistory=null;void recoverSource();}}
$('config-select').addEventListener('change',event=>{const config=state.configs.find(c=>c.url===event.target.value);if(config)selectConfig(config).then(afterHistoryConfig);});
$('add-config').addEventListener('click',()=>$('configs-dialog').showModal());
$('status-configs').addEventListener('click',()=>$('configs-dialog').showModal());
$('config-form').addEventListener('submit',event=>{
  event.preventDefault();const url=$('config-url').value.trim();
  let config=state.configs.find(c=>c.url===url);
  if(!config){config={name:'自定义配置',url};state.configs.push(config);}
  $('configs-dialog').close();selectConfig(config).then(afterHistoryConfig);
});
$('catalog-retry').addEventListener('click',()=>loadCatalog());
$('category-select').addEventListener('change',event=>{state.category=event.target.value;state.genre='all';state.page=1;state.q='';
  $('search-input').value='';renderCategories();loadCatalog();});
$('search-form').addEventListener('submit',event=>{event.preventDefault();state.q=$('search-input').value.trim();state.page=1;
  state.category='';state.genre='all';renderCategories();state.q?searchConfig():loadCatalog();});
$('stop-search').addEventListener('click',()=>{stopSearchRequests();$('search-progress').textContent='搜索已暂停 · 已找到 '+searchCount()+' 条结果';$('stop-search').hidden=true;});
$('clear-search').addEventListener('click',()=>{abort('search');state.q='';state.page=1;$('search-input').value='';loadCatalog();});
$('refresh-library').addEventListener('click',()=>{const previous=state.catalogSource;state.catalogSource='';state.page=1;state.category='';loadCatalog(previous);});
$('previous-page').addEventListener('click',()=>{state.page--;loadCatalog();window.scrollTo({top:0});});
$('next-page').addEventListener('click',()=>{state.page++;loadCatalog();window.scrollTo({top:0});});
$('episode-order').addEventListener('click',()=>{state.reverse=!state.reverse;renderEpisodes();});
$('more-episodes').addEventListener('click',()=>{state.shown+=180;renderEpisodes();});
$('next-episode').addEventListener('click',()=>{state.autoAttempt=0;playEpisode(state.episode+1,false);});
$('play-retry').addEventListener('click',()=>{state.autoAttempt=0;state.current?playEpisode(state.episode,false):loadCandidate(state.pendingCandidate);});
$('direct-nav').addEventListener('click',()=>$('direct-dialog').showModal());
function openDirect(url,record=null){
  goHome();state.historyRecord=record;$('direct-dialog').close();$('browse-view').hidden=true;$('watch-view').hidden=false;
  state.current={direct:true,title:'链接播放 · '+new URL(url).hostname,sourceName:'直接播放',lines:[{name:'视频链接',episodes:[{name:'播放',url,direct:true}]}]};
  state.line=0;state.episode=0;$('watch-title').textContent=state.current.title;$('watch-meta').textContent=new URL(url).hostname;
  $('watch-actors').textContent='';$('watch-description').textContent='直接打开的视频链接。';$('watch-source').textContent='直接播放';
  renderLines();renderEpisodes();void playEpisode(0,false);
}
$('direct-form').addEventListener('submit',event=>{
  event.preventDefault();const url=$('direct-url').value.trim();let parsed;
  try{parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error();}
  catch{textForm('direct-message','请输入有效的 HTTP / HTTPS 视频地址。',true);return;}
  openDirect(url);
});
window.addEventListener('pagehide',()=>{for(const key of Object.keys(state.controllers))abort(key);stopPlayer();});
async function initialize() {
  void history.refresh();
  try {
    const data=await api('/api/configs');state.configs=data.configs;
    if(!state.config)await selectConfig(state.configs.find(c=>c.default)||state.configs[0],true);else renderConfigs();
  } catch(error) {catalogStatus('服务尚未就绪',error.message+' 如果刚更新过版本，请先重启本机服务。');}
}
initialize();
