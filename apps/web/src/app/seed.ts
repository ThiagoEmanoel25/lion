export const demoConversations=[
 {id:'demo-1',contact:{name:'Marina Costa',phone:'+55 71 99912-4830'},status:'AUTOMATED',mode:'AI',unreadCount:2,updatedAt:new Date().toISOString(),messages:[{body:'Perfeito, pode ser amanhã à tarde?'}]},
 {id:'demo-2',contact:{name:'Rafael Lima',phone:'+55 71 98842-1029'},status:'QUEUED',mode:'HUMAN',unreadCount:1,updatedAt:new Date(Date.now()-240000).toISOString(),messages:[{body:'Queria falar com uma pessoa, por favor.'}]},
 {id:'demo-3',contact:{name:'Beatriz Alves',phone:'+55 71 99152-6207'},status:'QUEUED',mode:'PAUSED',unreadCount:1,updatedAt:new Date(Date.now()-540000).toISOString(),messages:[{body:'Tenho alergia a alguns produtos.'}]}
];
export const demoMessages=[
 {id:'1',direction:'INBOUND',body:'Oi! Vi um post sobre harmonização facial e queria saber mais.',createdAt:'2026-10-13T13:32:00Z'},
 {id:'2',direction:'OUTBOUND',body:'Olá, Marina! Posso te explicar como funciona e verificar horários. Você já fez esse procedimento antes?',createdAt:'2026-10-13T13:32:20Z'},
 {id:'3',direction:'INBOUND',body:'Nunca fiz. Tenho receio de ficar artificial.',createdAt:'2026-10-13T13:34:00Z'},
 {id:'4',direction:'OUTBOUND',body:'A proposta é preservar seus traços com um planejamento individual. Você prefere Pituba ou Caminho das Árvores?',createdAt:'2026-10-13T13:34:11Z'},
 {id:'5',direction:'INBOUND',body:'Pituba. E de preferência à tarde.',createdAt:'2026-10-13T13:36:00Z'}
];
