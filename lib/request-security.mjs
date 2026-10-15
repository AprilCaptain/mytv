import { HttpError } from './util.mjs';
export function localRequestUrl(target,host){
  const base='http://'+host;
  if(!target?.startsWith('/')||target.startsWith('//'))throw new HttpError(400,'Invalid request target');
  const url=new URL(target,base);
  if(url.origin!==base)throw new HttpError(400,'Invalid request origin');
  return url;
}
