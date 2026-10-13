import { HttpError, webUrl } from './util.mjs';
import { historyEpisode, sameFilm,filmTitle,filmYear,filmFamily,nextHistoryEpisode } from '../public/history-utils.js';

export class HistoryService {
  constructor(store,providers,discovery){this.store=store;this.providers=providers;this.discovery=discovery;}
  async context(body,signal) {
    if(body.url){const url=webUrl(body.url).href;return {meta:this.store.metadata({title:'链接播放 · '+new URL(url).hostname}),
      locator:{direct:true,url},episodeKey:'link',episodeName:'播放'};}
    const source=this.providers.source(body.source);
    const config=this.providers.configuration(source.configId);
    const detail=await this.providers.detail(source.id,String(body.id),signal);
    const line=detail.lines[Number(body.line)],episode=line?.episodes[Number(body.episode)];
    if(!episode)throw new HttpError(400,'请选择有效的集数。');
    return {meta:this.store.metadata(detail),episodeKey:historyEpisode(episode.name,detail.type),episodeName:episode.name,
      locator:{configUrl:config.url,configName:String(body.configName||'历史配置').slice(0,100),sourceKey:source.key,
        sourceApi:source.api,sourceName:source.name,videoId:detail.id,lineName:line.name,episodeName:episode.name,hasNext:nextHistoryEpisode(line.episodes,Number(body.episode),detail.type)>=0}};
  }
  async prepare(body,signal){const c=await this.context(body,signal);return {...this.store.prepare(c.meta,c.locator,c.episodeKey,body.filmId,body.distinct),meta:c.meta};}
  async start(body,signal){const claimedAt=this.store.claimTime(),generation=this.store.clearGeneration;
    const context=await this.context(body,signal);
    if(generation!==this.store.clearGeneration)throw new HttpError(409,'历史已清空，请重新开始播放以保存新记录。');
    return this.store.start({...context,claimedAt,filmId:body.filmId,distinct:body.distinct===true,
    position:body.position,duration:body.duration});}
  async resolveRecord(id,signal) {
    const record=this.store.get(id),locator=record.episode?.locator;
    if(!locator)throw new HttpError(404,'记录没有可恢复的播放入口。');
    if(locator.direct)return {record,directUrl:locator.url};
    let config;
    try{config=await this.providers.importConfig(locator.configUrl,signal);}catch(error){return {record,error:error.message,candidates:[],changeConfig:true};}
    const source=config.sources.find(s=>s.supported&&s.key===locator.sourceKey)||config.sources.find(s=>s.supported&&s.api===locator.sourceApi);
    if(source)try {
      const detail=await this.providers.detail(source.id,locator.videoId,signal);
      if(sameFilm(detail,record)||detail.title===record.title&&detail.year===record.year&&detail.type===record.type){
        const matches=detail.lines.flatMap((line,index)=>line.episodes.map((ep,episode)=>({line:index,episode,name:line.name,ep})))
          .filter(x=>historyEpisode(x.ep.name,detail.type)===record.episode.key);
        const route=matches.find(x=>x.name===locator.lineName)||matches[0];
        if(route)return {record,config, candidate:{...detail,source:source.id,sourceName:source.name,kind:source.kind},
          line:route.line,episode:route.episode};
      }
    }catch(error){if(signal?.aborted)throw error;}
    return {record,config,...await this.matches(record,config.id,signal)};
  }
  async matches(record,configId,signal,excluded=[]){
    const response=this.discovery.stream(configId,record.title,null,excluded,signal),reader=response.body.getReader();
    const decoder=new TextDecoder();let pending='',candidates=[];
    try{while(true){const{done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let n;
      while((n=pending.indexOf('\n'))>=0){const raw=pending.slice(0,n);pending=pending.slice(n+1);if(!raw)continue;const data=JSON.parse(raw);
        if(data.type==='results')candidates.push(...data.list.filter(v=>filmTitle(v.title)===filmTitle(record.title)&&
          (!filmYear(v.year)||!filmYear(record.year)||filmYear(v.year)===filmYear(record.year))&&
          (!filmFamily(v.type)||!filmFamily(record.type)||filmFamily(v.type)===filmFamily(record.type))).map(v=>({...v,verified:sameFilm(v,record)})));}}}
    finally{await reader.cancel().catch(()=>{});}
    if(candidates.length===1&&candidates[0].verified)return {candidate:candidates[0],episodeName:record.episode.name};
    return {candidates,error:candidates.length?'找到多个同片版本，请选择片源。':'原入口不可用，没有找到可确认的同片版本。',changeConfig:!candidates.length};
  }
}
