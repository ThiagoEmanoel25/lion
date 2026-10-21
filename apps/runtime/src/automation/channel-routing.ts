export type ChannelRouteKeyword={id:string;keyword:string;normalizedKeyword:string;match:'EXACT'|'CONTAINS';playbookId:string};
export type ChannelRouteInput={body:string;keywords:ChannelRouteKeyword[];welcomePlaybookId?:string;defaultPlaybookId?:string;firstMessage:boolean;hasRecentExecution:boolean};
export type ChannelRoute={playbookId:string;reason:'keyword'|'welcome'|'default';keywordId?:string}|null;

export function normalizeInboundText(value:string){return value.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ')}

export function selectInboundRoute(input:ChannelRouteInput):ChannelRoute{
  const text=normalizeInboundText(input.body);
  const matches=input.keywords.filter(item=>item.normalizedKeyword&&(item.match==='EXACT'?text===item.normalizedKeyword:text.includes(item.normalizedKeyword))).sort((a,b)=>{
    if(a.match!==b.match)return a.match==='EXACT'?-1:1;
    return b.normalizedKeyword.length-a.normalizedKeyword.length;
  });
  const keyword=matches[0];
  if(keyword)return {playbookId:keyword.playbookId,reason:'keyword',keywordId:keyword.id};
  if(input.firstMessage&&input.welcomePlaybookId)return {playbookId:input.welcomePlaybookId,reason:'welcome'};
  if(!input.hasRecentExecution&&input.defaultPlaybookId)return {playbookId:input.defaultPlaybookId,reason:'default'};
  return null;
}
