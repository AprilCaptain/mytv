import { HttpError } from './util.mjs';
import { WebsiteContext } from './websites/common.mjs';
import { hdmoli } from './websites/hdmoli.mjs';
import { a123tv } from './websites/a123tv.mjs';
import { jinpai } from './websites/jinpai.mjs';
import { mediaType } from './media-security.mjs';
const adapters=new Map([['hdmoli',hdmoli],['a123tv',a123tv],['jinpai',jinpai]]);
const methods={home:'categories',homeContent:'categories',homeVod:'home',homeVideoContent:'home',category:'category',categoryContent:'category',search:'search',searchContent:'search',detail:'detail',detailContent:'detail',play:'play',playerContent:'play'};
export class WebSources{
  constructor(fetcher){this.fetcher=fetcher;}
  capability(adapter){return adapters.has(adapter);}
  async call(source,method,args,signal){const adapter=adapters.get(source.adapter),operation=Object.hasOwn(methods,method)?methods[method]:null;if(!adapter||!operation)throw new HttpError(400,'网站适配方式不受支持。');
    const deadline=AbortSignal.timeout(20_000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
    const ctx=new WebsiteContext(source,this.fetcher),result=await adapter[operation](ctx,args,combined);
    if(operation==='play')await this.checkMedia(result,combined);
    return result;}
  async checkMedia(result,signal){
    const combined=AbortSignal.any([signal,AbortSignal.timeout(6500)]);
    const response=await this.fetcher(result.url,{headers:{...result.header,range:'bytes=0-1023'},signal:combined});
    const reader=response.body?.getReader();
    try{
      if(!response.ok||!reader)throw new HttpError(502,'这条线路暂时无法连接，请切换线路。');
      const hls=/mpegurl/i.test(response.headers.get('content-type')||'')||/\.m3u8(?:$|[?#])/i.test(result.url);
      if(!hls)mediaType(response.headers.get('content-type')||'');
      const chunk=await reader.read();if(!chunk.value?.length)throw new HttpError(502,'这条线路没有返回视频，请切换线路。');
      if(hls){
        if(!Buffer.from(chunk.value).toString('utf8').trimStart().startsWith('#EXTM3U'))throw new HttpError(502,'这条线路没有返回有效播放列表，请切换线路。');
      }
    }finally{await reader?.cancel().catch(()=>{});}
  }
}
