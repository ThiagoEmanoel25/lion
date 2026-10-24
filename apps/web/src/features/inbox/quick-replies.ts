export type ShortcutToken={start:number;end:number;search:string};

export function shortcutToken(text:string,cursor=text.length):ShortcutToken|null{
  const end=Math.max(0,Math.min(cursor,text.length));
  const match=text.slice(0,end).match(/(^|\s)\/([a-z0-9_-]*)$/i);
  return match?{start:(match.index??0)+match[1].length,end,search:match[2].toLowerCase()}:null;
}

export function replaceShortcut(text:string,token:ShortcutToken,replacement:string){
  return `${text.slice(0,token.start)}${replacement}${text.slice(token.end)}`;
}

export function quickReplyKey(key:string,index:number,count:number):{action:'move'|'insert'|'close'|'none';index:number}{
  if(key==='Escape')return {action:'close',index};if(!count)return {action:'none',index};
  if(key==='ArrowDown')return {action:'move',index:(index+1)%count};if(key==='ArrowUp')return {action:'move',index:(index-1+count)%count};if(key==='Enter')return {action:'insert',index};return {action:'none',index};
}
