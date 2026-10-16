import {historyEpisode} from './history-utils.js';
export function qualityOptions(levels){
 return levels.map((l,index)=>({index,width:l.width||0,height:l.height||0,bitrate:l.bitrate||0,videoCodec:l.videoCodec||'',audioCodec:l.audioCodec||'',
  label:[l.width&&l.height?l.width+'×'+l.height:'档位 '+(index+1),l.bitrate>0?(l.bitrate/1e6).toFixed(1)+' Mbps':''].filter(Boolean).join(' · ')}))
  .sort((a,b)=>b.width*b.height-a.width*a.height||b.height-a.height||b.bitrate-a.bitrate);
}
export function alternateLine(lines,current,failed,source,episodeName,type){
 const rank=s=>/4k|2160p|uhd/i.test(s)?40:/蓝光|原画|1080p/i.test(s)?20:/720p|高清/i.test(s)?10:0;
 return lines.map((line,index)=>({line,index,episode:line.episodes.findIndex(ep=>ep.name===episodeName)})).map(v=>({...v,episode:v.episode>=0?v.episode:v.line.episodes.findIndex(ep=>historyEpisode(ep.name,type)===historyEpisode(episodeName,type))}))
  .filter(v=>v.index!==current&&!failed.has(source+':'+v.index)&&v.episode>=0).sort((a,b)=>rank(b.line.name)-rank(a.line.name))[0]||null;
}
export function streamFailure(data={}){
 const detail=String(data.details||''),status=Number(data.response?.code||data.response?.status||0);
 let message='这条线路暂时无法播放，请尝试其他线路。';
 if(/codec|bufferAddCodec|bufferAppend|decod/i.test(detail))message='当前浏览器无法解码这条线路的视频，请尝试其他线路。';
 else if(/key|decrypt/i.test(detail))message='这条线路的视频密钥不可用，请尝试其他线路。';
 else if(/timeout/i.test(detail))message=/frag/i.test(detail)?'视频分片加载超时，请尝试其他线路。':'播放列表加载超时，请尝试其他线路。';
 else if([404,410].includes(status))message='这条线路的视频地址已失效，请尝试其他线路。';
 else if(status===401||status===403)message='视频服务拒绝了这次播放，请尝试其他线路。';
 else if(/load|network/i.test(detail))message='视频数据暂时无法加载，请尝试其他线路。';
 return {message,detail:[detail,status?'HTTP '+status:''].filter(Boolean).join(' · ')};
}
export function watchPlayback(video,onTimeout,{startupMs=16000,stallMs=20000}={}){
 let timer,disposed=false,started=false,requested=false;
 const clear=()=>clearTimeout(timer);
 function arm(phase){clear();const at=video.currentTime;
  timer=setTimeout(()=>{if(disposed||video.ended||requested&&video.paused)return;
   if(video.videoWidth>0&&video.currentTime>at+.25){arm('stall');return;}
   onTimeout(phase==='startup'?'这条线路长时间没有显示画面，请尝试其他线路。':'这条线路持续缓冲，请尝试其他线路。');
  },phase==='startup'?startupMs:stallMs);
 }
 const play=()=>{requested=true;arm(started?'stall':'startup');};
 const playing=()=>{if(video.videoWidth>0){started=true;clear();}};
 const waiting=()=>{if(!video.paused||!requested)arm(started?'stall':'startup');};
 const pause=()=>{if(requested)clear();};
 const events={play,playing,waiting,stalled:waiting,pause,ended:clear};
 for(const [event,handler] of Object.entries(events))video.addEventListener(event,handler);
 return {start(){arm('startup');},stop:clear,dispose(){disposed=true;clear();for(const [event,handler] of Object.entries(events))video.removeEventListener(event,handler);}};
}
