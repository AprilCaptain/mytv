import { HttpError, readBytes, webUrl } from './util.mjs';

// Never serve active documents from the application's origin, even if a source
// labels one as a video. Unknown binary types are downloads, not executable MIME.
export function mediaType(raw='') {
  const type=String(raw).split(';')[0].trim().toLowerCase();
  if(type.startsWith('video/')||type.startsWith('audio/'))return type;
  if(['application/octet-stream','binary/octet-stream','application/mp4','application/ogg'].includes(type))return type;
  if(!type)return 'application/octet-stream';
  throw new HttpError(422,'这条线路没有返回可播放的视频，请更换线路。');
}
export function rasterType(bytes) {
  if(bytes.subarray(0,3).equals(Buffer.from([255,216,255])))return 'image/jpeg';
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(/^GIF8[79]a/.test(bytes.subarray(0,6).toString('ascii')))return 'image/gif';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  if(bytes.subarray(4,8).toString()==='ftyp'&&['avif','avis'].includes(bytes.subarray(8,12).toString()))return 'image/avif';
  throw new HttpError(422,'海报格式不受支持。');
}
export async function posterResponse(raw,fetcher,signal) {
  const url=webUrl(raw).href;
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(12_000)]):AbortSignal.timeout(12_000);
  const response=await fetcher(url,{signal:combined,timeout:12_000});
  if(!response.ok){await response.body?.cancel();throw new HttpError(502,'暂时无法加载海报。');}
  const bytes=await readBytes(response,5*1024*1024);
  return new Response(bytes,{headers:{'content-type':rasterType(bytes),'x-content-type-options':'nosniff',
    'content-security-policy':"default-src 'none'; sandbox",'cache-control':'private, max-age=300'}});
}
