export function episodeVisibleCount(total,index,reverse,shown,batch=180){
 const position=reverse?total-1-index:index;
 const needed=Number.isInteger(index)&&index>=0&&index<total?Math.ceil((position+1)/batch)*batch:0;
 return Math.min(total,Math.max(batch,shown,needed));
}

export function revealEpisode(list){
 const selected=list.querySelector('.episode-button.selected');
 if(!selected||!list.clientHeight)return;
 const item=selected.getBoundingClientRect(),box=list.getBoundingClientRect();
 const top=box.top+list.clientTop,bottom=top+list.clientHeight;
 if(item.top>=top&&item.bottom<=bottom)return;
 // Scroll only this panel, keeping the player and the rest of the page in place.
 const target=list.scrollTop+item.top-top-(list.clientHeight-item.height)/2;
 list.scrollTop=Math.max(0,Math.min(list.scrollHeight-list.clientHeight,target));
}
