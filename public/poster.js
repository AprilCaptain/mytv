// A transient network failure should not leave a card blank until page reload.
export function loadPoster(image,poster,{schedule=setTimeout}={}){
 const placeholder='/placeholder.svg',url=poster?'/api/poster?'+new URLSearchParams({url:poster}):placeholder;
 image.alt='';image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';
 let retried=false;
 image.addEventListener('error',()=>{
  if(image.getAttribute('src')===placeholder)return;
  image.src=placeholder;
  if(!retried){retried=true;schedule(()=>{if(image.isConnected)image.src=url;},1200);}
 });
 image.src=url;return image;
}
