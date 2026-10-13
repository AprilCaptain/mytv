import { resumeDecision,filmFamily } from './history-utils.js';
const $=id=>document.getElementById(id);
const format=t=>{t=Math.max(0,Math.floor(t||0));return (t>=3600?Math.floor(t/3600)+':':'')+String(Math.floor(t/60)%60).padStart(2,'0')+':'+String(t%60).padStart(2,'0');};
function node(tag,cls,text){const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;}
export function createHistory({api,video,resume,onFailure,onEnd}) {
  let route=null,prepared=null,session=null,seq=0,epoch=0,ready=false,claiming=false,needsClaim=false,owns=true;
  let decisionBusy=false,seeking=false,choiceResolve=null,deleted=false,pendingSave=Promise.resolve(),hasPlayed=false,failed=false,lastStable=null;
  let historyPage=1,historyQuery='',refreshToken=0,searchTimer,removing=false;
  function historyError(message,error){$('history-message').textContent=message;$('history-error-details').hidden=false;$('history-error-details').open=false;$('history-error-detail').textContent=error.message;}
  function choose(title,message,options){
    if(choiceResolve)choiceResolve(null);
    const dialog=$('history-choice');$('history-choice-title').textContent=title;$('history-choice-message').textContent=message;
    $('history-choice-actions').replaceChildren();
    return new Promise(resolve=>{
      choiceResolve=value=>{choiceResolve=null;if(dialog.open)dialog.close();resolve(value);};
      for(const option of options){const b=node('button','button secondary',option.label);b.addEventListener('click',()=>choiceResolve?.(option.value));$('history-choice-actions').append(b);}
      if(!dialog.open)dialog.showModal();
    });
  }
  $('history-choice').addEventListener('cancel',()=>choiceResolve?.(null));
  $('history-choice').addEventListener('close',()=>choiceResolve?.(null));
  function card(item,compact=false){
    const row=node('article',compact?'history-card compact':'history-card');
    const cover=node('img','history-cover');cover.src=/^https?:\/\//.test(item.poster||'')?item.poster:'/placeholder.svg';cover.alt='';cover.loading='lazy';cover.addEventListener('error',()=>cover.src='/placeholder.svg',{once:true});
    const info=node('div','history-info'),ep=item.episode||{};
    info.append(node('strong','',item.title),node('span','history-meta',[item.year,item.type,ep.name,ep.completed?'已看完':format(ep.position)+' / '+format(ep.duration)].filter(Boolean).join(' · ')));
    const bar=node('progress','history-progress');bar.max=ep.duration||1;bar.value=ep.completed?bar.max:ep.position||0;bar.setAttribute('aria-label','观看进度');info.append(bar);
    const date=new Date(item.lastPlayed).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    info.append(node('small','',date+' · '+(ep.locator?.direct?'链接播放':[ep.locator?.configName,ep.locator?.sourceName,ep.locator?.lineName].filter(Boolean).join(' / '))));
    const next=ep.locator?.hasNext&&item.kind==='vod'&&filmFamily(item.type)!=='movie';
    const actions=node('div','history-actions'),label=ep.completed?(next?'播放下一集':'重新播放'):'继续观看';
    if(compact){const play=node('button','button primary',label);play.addEventListener('click',()=>resume(item.id));actions.append(play);row.append(cover,info,actions);}
    else {
      const open=node('button','history-open');open.setAttribute('aria-label',label+'：'+item.title);open.append(cover,info);open.addEventListener('click',()=>resume(item.id));
      const del=node('button','history-delete','删除');del.setAttribute('aria-label','删除观看记录：'+item.title);
      del.addEventListener('click',()=>void removeHistory(item));actions.append(del);row.append(open,actions);
      row.addEventListener('click',event=>{if(event.target===row||event.target===actions)resume(item.id);});
    }
    return row;
  }
  async function removeHistory(item){
    if(removing)return;removing=true;
    try{
      const confirmed=await choose(item?'删除观看记录':'清空观看历史',item?'删除「'+item.title+'」的观看记录和各集进度？删除后无法恢复。':'将删除全部观看记录和各集进度，包括未显示的记录。所有设备均受影响，删除后无法恢复。',[
        {label:'取消',value:false},{label:item?'删除':'清空全部历史',value:true}]);
      if(!confirmed)return;
      await pendingSave;
      await api('/api/history'+(item?'/'+item.id:''),{method:'DELETE',body:{}});
      if(!item||session?.filmId===item.id||prepared?.filmId===item.id){epoch++;session=null;ready=false;deleted=true;claiming=false;needsClaim=false;}
      if(!item){historyPage=1;historyQuery='';$('history-search').value='';clearTimeout(searchTimer);}
      await refresh();
    }catch(e){historyError('暂时无法删除，请稍后重试。',e);}
    finally{removing=false;}
  }
  async function refresh(){
    const token=++refreshToken;
    await pendingSave;
    const params=new URLSearchParams({q:historyQuery,page:String(historyPage)});
    try{const [data,latest]=await Promise.all([api('/api/history?'+params),api('/api/history/latest')]);
      if(token!==refreshToken)return;
      historyPage=data.page;$('history-list').replaceChildren(...data.items.map(item=>card(item)));
      $('history-message').textContent=data.total?(historyQuery?'找到 '+data.total+' 条记录':'共 '+data.total+' 条记录'):historyQuery?'没有找到相关记录，试试其他片名。':'还没有观看记录。';
      $('history-error-details').hidden=true;
      $('history-clear').disabled=!data.totalAll;
      $('history-pagination').hidden=data.pages<=1;
      $('history-page-label').textContent=data.page+' / '+data.pages;
      $('history-previous').disabled=data.page<=1;$('history-next').disabled=data.page>=data.pages;
      $('continue-card').replaceChildren();$('continue-section').hidden=!latest.item;
      if(latest.item)$('continue-card').append(card(latest.item,true));
    }catch(e){if(token===refreshToken)historyError('观看历史暂时无法加载，请稍后重试。',e);}
  }
  function searchHistory(){clearTimeout(searchTimer);historyQuery=$('history-search').value.trim();historyPage=1;void refresh();}
  $('history-search-form').addEventListener('submit',event=>{event.preventDefault();searchHistory();});
  $('history-search').addEventListener('input',()=>{clearTimeout(searchTimer);refreshToken++;searchTimer=setTimeout(searchHistory,250);});
  function changePage(delta){historyPage=Math.max(1,historyPage+delta);void refresh().then(()=>{if(!$('history-view').hidden)$('history-view').scrollIntoView?.({block:'start'});});}
  $('history-previous').addEventListener('click',()=>{if(historyPage>1)changePage(-1);});
  $('history-next').addEventListener('click',()=>changePage(1));
  $('history-clear').addEventListener('click',()=>void removeHistory());
  function save(completed=false,beacon=false){
    if(!ready||!session||deleted||video.seeking||video.readyState<2||!Number.isFinite(video.duration)||video.duration<=0||video.currentTime<0)return;
    const body={session:session.session,seq:++seq,position:Math.min(video.currentTime,video.duration),duration:video.duration,completed};
    if(beacon){navigator.sendBeacon('/api/history/progress',new Blob([JSON.stringify(body)],{type:'application/json'}));return;}
    pendingSave=api('/api/history/progress',{method:'POST',body}).then(r=>{if(session?.session===body.session)owns=r.accepted;}).catch(()=>{$('history-save-status').textContent='观看进度暂未保存，请检查连接。';});return pendingSave;
  }
  function reset(){save(video.ended);epoch++;ready=false;route=null;prepared=null;session=null;seq=0;decisionBusy=false;needsClaim=false;claiming=false;deleted=false;seeking=false;hasPlayed=false;failed=false;lastStable=null;
    $('resume-notice').hidden=true;$('history-save-status').textContent='';$('history-save-status').title='';choiceResolve?.(null);return pendingSave;}
  async function prepare(body,filmId,distinct=false){
    const token=epoch;route=body;
    try{
      const loaded=await api('/api/history/prepare',{method:'POST',body:{...body,filmId,distinct}});loaded.distinct=distinct;
      if(token!==epoch)return false;
      prepared=loaded;
      if(prepared.candidates.length){const chosen=await choose('继续上次观看？','选择看过的版本继续，或从头开始。',[
        ...prepared.candidates.map(r=>({label:r.title+' · '+(r.year||'年份未知')+' · '+(r.type||'类型未知'),value:r.id})),{label:'从头开始，另存记录',value:'distinct'}]);
        if(token!==epoch||chosen===null)return false;
        const selected=await api('/api/history/prepare',{method:'POST',body:{...body,filmId:chosen==='distinct'?undefined:chosen,distinct:chosen==='distinct'}});
        if(token!==epoch)return false;prepared=selected;
        prepared.distinct=chosen==='distinct';
      }
      return token===epoch;
    }catch(e){$('history-save-status').textContent='暂时无法读取观看进度。';$('history-save-status').title=e.message;prepared=null;return token===epoch;}
  }
  async function claim(){
    if(!ready||!route||!prepared||claiming||deleted||failed||!hasPlayed||video.paused||video.seeking||video.readyState<3)return;
    claiming=true;const token=epoch,body={...route,filmId:prepared.filmId,distinct:prepared.distinct,position:video.currentTime,duration:video.duration};
    try{const result=await api('/api/history/sessions',{method:'POST',body});if(token!==epoch)return;
      session=result;prepared.filmId=result.filmId;prepared.record=result.record||prepared.record;prepared.distinct=false;seq=0;owns=!result.superseded;needsClaim=false;$('history-save-status').textContent=result.superseded?'其他窗口正在观看，当前进度未同步。':'';
      if(!result.superseded)save(video.ended);
    }catch(e){if(token===epoch){$('history-save-status').textContent='观看进度暂未保存。';$('history-save-status').title=e.message;}}
    finally{if(token===epoch)claiming=false;}
  }
  function range(){if(!video.seekable.length)return null;return {start:video.seekable.start(0),end:video.seekable.end(video.seekable.length-1)};}
  async function locate(){
    if(!route||!prepared||ready||decisionBusy||deleted||failed)return;
    const d=resumeDecision(prepared.bookmark,video.duration,range());
    if(d.kind==='wait')return;
    decisionBusy=true;const token=epoch;let position=d.position||0;
    if(d.kind==='choice'){
      video.pause();const value=await choose('选择续播位置','上次看到 '+format(d.position)+'，当前视频时长 '+format(video.duration)+'。版本可能不同，请选择从哪里开始。',[
        ...(d.canResume?[{label:'按原时间继续',value:'resume'}]:[]),{label:'从头播放',value:'start'},{label:'手动定位',value:'manual'}]);
      if(token!==epoch)return;if(value===null){decisionBusy=false;ready=false;failed=true;onFailure?.('已取消续播，观看进度已保留。');return;}
      if(value==='manual'){prepared.bookmark=null;decisionBusy=false;ready=true;return;}
      position=value==='resume'?d.position:0;
    }
    if(token!==epoch)return;
    if(position>0){seeking=true;try{video.currentTime=position;}catch{seeking=false;decisionBusy=false;return;}}
    ready=true;decisionBusy=false;
    if(position>0){$('resume-notice').hidden=false;$('resume-notice').textContent='接着 '+format(position)+' 观看';}
    if(video.paused&&!video.ended)video.play().catch(()=>{});
    if(!video.paused&&!video.seeking){if(!session||needsClaim)void claim();else save();}
  }
  for(const event of ['loadedmetadata','durationchange','canplay','progress','playing'])video.addEventListener(event,()=>{
    if(event==='playing')hasPlayed=true;
    void locate();if(event==='playing'&&ready&&!video.seeking&&(needsClaim||!session))void claim();});
  video.addEventListener('play',()=>{if(decisionBusy&&$('history-choice').open)video.pause();});
  video.addEventListener('timeupdate',()=>{if(ready&&hasPlayed&&video.readyState>=3&&!video.seeking&&Number.isFinite(video.duration))lastStable={position:video.currentTime,duration:video.duration};});
  video.addEventListener('emptied',()=>{if(route&&prepared&&lastStable&&!failed){prepared.bookmark={...lastStable,completed:false};ready=false;hasPlayed=false;decisionBusy=false;seeking=false;}});
  video.addEventListener('seeked',()=>{if(seeking)seeking=false;if(ready){if((needsClaim||!session)&&!video.paused)void claim();else save();}});
  video.addEventListener('pause',()=>{if(ready&&!video.ended&&!video.seeking)save();});
  video.addEventListener('ended',()=>{save(true);onEnd?.();});
  const timer=setInterval(()=>{if(ready&&!video.paused&&!video.seeking&&video.readyState>=3){if(needsClaim||!session)void claim();else save();}},5000);
  const pollTimer=setInterval(()=>{if(!document.hidden&&($('watch-view').hidden||!$('history-view').hidden))void refresh();},10000);
  window.addEventListener('pagehide',()=>save(video.ended,true));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)save();else if($('watch-view').hidden)void refresh();});
  return {prepare,reset,save,refresh,choose,requestClaim(){if(ready)needsClaim=true;},markFailed(){ready=false;failed=true;},dispose(){refreshToken++;clearTimeout(searchTimer);clearInterval(timer);clearInterval(pollTimer);},get bookmark(){return prepared?.bookmark;},get record(){return prepared?.record;},get filmId(){return prepared?.filmId;},get distinct(){return prepared?.distinct;}};
}
