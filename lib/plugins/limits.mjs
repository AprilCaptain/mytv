import { Transform } from 'node:stream';
import { HttpError } from '../util.mjs';
export const MAX_PLUGIN_FRAME=16*1024*1024;
export function boundedLines(limit=MAX_PLUGIN_FRAME) {
  let pending=0;
  return new Transform({transform(chunk,_encoding,done){
    let start=0;
    for(let end=chunk.indexOf(10);end>=0;end=chunk.indexOf(10,start)){
      pending+=end-start;
      if(pending>limit)return done(new HttpError(502,'插件响应超过大小限制。'));
      pending=0;start=end+1;
    }
    pending+=chunk.length-start;
    if(pending>limit)return done(new HttpError(502,'插件响应超过大小限制。'));
    done(null,chunk);
  }});
}
