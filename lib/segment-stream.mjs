// Strip a small image camouflage prefix only when five MPEG-TS sync packets
// prove that a raster-labelled response actually contains a TS segment.
export async function normalizeRasterTs(response){
  const type=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
  if(!['image/png','image/jpeg'].includes(type)||!response.body)return response;
  const reader=response.body.getReader(),chunks=[];let length=0,finished=false;
  try{while(length<1024){const {value,done}=await reader.read();if(done){finished=true;break;}chunks.push(value);length+=value.length;}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  let prefix=Buffer.concat(chunks,length),offset=0;
  const image=prefix.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||prefix.subarray(0,3).equals(Buffer.from([255,216,255]));
  if(image)for(let i=1;i<Math.min(4096,prefix.length-4*188);i++)if([0,1,2,3,4].every(n=>prefix[i+n*188]===71)){offset=i;break;}
  const headers=new Headers(response.headers);
  if(offset){prefix=prefix.subarray(offset);for(const key of ['content-length','content-range','accept-ranges'])headers.delete(key);}
  const body=new ReadableStream({
    start(controller){if(prefix.length)controller.enqueue(prefix);if(finished)controller.close();},
    async pull(controller){if(finished)return;try{const {value,done}=await reader.read();if(done){finished=true;controller.close();}else controller.enqueue(value);}catch(error){finished=true;controller.error(error);}},
    cancel(reason){finished=true;return reader.cancel(reason);}
  });
  return new Response(body,{status:offset?200:response.status,headers});
}
