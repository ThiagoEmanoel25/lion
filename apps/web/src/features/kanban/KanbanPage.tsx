import {useEffect,useMemo,useState,type DragEvent} from 'react';
import {Link} from 'react-router-dom';
import {ArrowLeft,ArrowRight,ChevronDown,Clock3,MoreHorizontal,Plus,Trash2,UserPlus,X} from 'lucide-react';
import type {KanbanBoard,KanbanColumn} from '../../shared/types/api';
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/AsyncState';
import {useToast} from '../../shared/ui/Toast';
import {useSession} from '../../app/providers/SessionProvider';
import {ApiError} from '../../shared/api/client';
import {useContacts} from '../contacts/api/queries';
import {describeApiError} from '../settings/errors';
import {plural} from '../settings/labels';
import {Dialog} from './Dialog';
import {useAddCard,useRemoveCard,useCreateBoard,useCreateColumn,useDeleteBoard,useDeleteColumn,useKanbanBoards,useMoveCard,useUpdateBoard,useUpdateColumn} from './api/queries';
import './kanban.css';

const elapsed=(date:string)=>{const seconds=Math.max(0,Math.floor((Date.now()-new Date(date).getTime())/1000));if(seconds<60)return'agora';if(seconds<3600)return`${Math.floor(seconds/60)} min`;if(seconds<86400)return`${Math.floor(seconds/3600)} h`;return`${Math.floor(seconds/86400)} d`};
type Dlg={kind:'board-new'}|{kind:'board-rename'}|{kind:'board-delete'}|{kind:'col-new'}|{kind:'col-rename';column:KanbanColumn}|{kind:'col-delete';column:KanbanColumn}|{kind:'card-add'}|{kind:'card-remove';card:{id:string;name:string}};
type Flow={id:string;name:string};
/** Mensagem do Kanban; para KANBAN_IN_USE_BY_FLOW devolve também a lista de fluxos que usam o item. */
export function kanbanError(error:unknown,fallback:string):{message:string;flows:Flow[]}{
  if(error instanceof ApiError&&error.code==='KANBAN_IN_USE_BY_FLOW'){const flows=((error.details as {flows?:Flow[]}|undefined)?.flows??[]).filter(item=>item?.name);return {message:'Não dá para excluir: este item é usado por fluxo(s) publicado(s). Ajuste ou despublique o fluxo antes.',flows}}
  return {message:describeApiError(error,fallback),flows:[]};
}
const palette=['#17765b','#2e7dbe','#805ad5','#d97706','#dc4c64','#64748b'];

function NameForm({title,label,initial,submitLabel,onSubmit,onClose}:{title:string;label:string;initial:string;submitLabel:string;onSubmit:(name:string)=>Promise<void>;onClose:()=>void}){
  const [name,setName]=useState(initial);const [error,setError]=useState<{message:string;flows:Flow[]}|null>(null);const [busy,setBusy]=useState(false);
  return <Dialog title={title} onClose={onClose}><form onSubmit={async event=>{event.preventDefault();if(!name.trim())return;setBusy(true);setError(null);try{await onSubmit(name.trim())}catch(caught){setError(kanbanError(caught,'Não foi possível concluir a ação.'))}finally{setBusy(false)}}}>
    <label>{label}<input data-autofocus value={name} maxLength={80} required onChange={event=>setName(event.target.value)}/></label>
    <ErrorBox error={error}/>
    <footer><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy||!name.trim()}>{submitLabel}</button></footer></form></Dialog>
}
function ErrorBox({error}:{error:{message:string;flows:Flow[]}|null}){return error?<div className="kanban-dialog-error" role="alert">{error.message}{error.flows.length>0&&<ul>{error.flows.map(flow=><li key={flow.id}>{flow.name}</li>)}</ul>}</div>:null}
function ConfirmForm({title,children,confirmLabel,onConfirm,onClose}:{title:string;children:React.ReactNode;confirmLabel:string;onConfirm:()=>Promise<void>;onClose:()=>void}){
  const [error,setError]=useState<{message:string;flows:Flow[]}|null>(null);const [busy,setBusy]=useState(false);
  return <Dialog title={title} onClose={onClose}>{children}<ErrorBox error={error}/><footer><button data-autofocus onClick={onClose}>Cancelar</button><button className="danger" disabled={busy} onClick={async()=>{setBusy(true);setError(null);try{await onConfirm()}catch(caught){setError(kanbanError(caught,'Não foi possível concluir a ação.'))}finally{setBusy(false)}}}>{confirmLabel}</button></footer></Dialog>
}
function AddContactForm({board,onSubmit,onClose}:{board:KanbanBoard;onSubmit:(input:{contactId:string;columnId:string})=>Promise<void>;onClose:()=>void}){
  const [search,setSearch]=useState('');const [term,setTerm]=useState('');const [contactId,setContactId]=useState('');const [columnId,setColumnId]=useState(board.columns[0]?.id??'');const [error,setError]=useState<{message:string;flows:Flow[]}|null>(null);const [busy,setBusy]=useState(false);
  useEffect(()=>{const id=window.setTimeout(()=>setTerm(search.trim()),250);return()=>window.clearTimeout(id)},[search]);
  const contacts=useContacts({search:term});
  return <Dialog title="Adicionar contato ao quadro" onClose={onClose}><form onSubmit={async event=>{event.preventDefault();if(!contactId)return;setBusy(true);setError(null);try{await onSubmit({contactId,columnId})}catch(caught){setError(kanbanError(caught,'Não foi possível adicionar o contato.'))}finally{setBusy(false)}}}>
    <label>Buscar contato<input data-autofocus type="search" role="searchbox" placeholder="Nome ou telefone" value={search} onChange={event=>setSearch(event.target.value)}/></label>
    <div className="kanban-contact-list" role="listbox" aria-label="Contatos encontrados">{contacts.isLoading?<small>Buscando…</small>:contacts.data?.items.length?contacts.data.items.slice(0,30).map(contact=><button type="button" role="option" aria-selected={contactId===contact.id} key={contact.id} onClick={()=>setContactId(contact.id)}><b>{contact.name||contact.phone}</b><small>{contact.phone}</small></button>):<small>Nenhum contato encontrado. Cadastre contatos em Contatos.</small>}</div>
    <label>Coluna<select value={columnId} onChange={event=>setColumnId(event.target.value)}>{board.columns.map(column=><option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
    <ErrorBox error={error}/>
    <footer><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy||!contactId}>Adicionar ao quadro</button></footer></form></Dialog>
}

export function KanbanPage(){
  const {session}=useSession();const toast=useToast();const manage=['OWNER','ADMIN'].includes(session?.workspace.role??'');
  const boards=useKanbanBoards();const createBoard=useCreateBoard();const updateBoard=useUpdateBoard();const deleteBoard=useDeleteBoard();const createColumn=useCreateColumn();const updateColumn=useUpdateColumn();const deleteColumn=useDeleteColumn();const moveCard=useMoveCard();const addCard=useAddCard();const removeCard=useRemoveCard();
  const [boardId,setBoardId]=useState('');const [dragged,setDragged]=useState<string|null>(null);const [dlg,setDlg]=useState<Dlg|null>(null);const [error,setError]=useState('');
  useEffect(()=>{if(!boardId&&boards.data?.[0])setBoardId(boards.data[0].id);else if(boardId&&boards.data&&!boards.data.some(board=>board.id===boardId))setBoardId(boards.data[0]?.id??'')},[boardId,boards.data]);
  const board=useMemo(()=>boards.data?.find(item=>item.id===boardId)??null,[boards.data,boardId]);
  const run=async(action:()=>Promise<unknown>,done?:string)=>{setError('');try{await action();if(done)toast.success(done)}catch(caught){const message=kanbanError(caught,'Não foi possível concluir a ação.').message;setError(message);toast.error(message)}};
  /** Ação de diálogo: o erro volta ao diálogo (que mostra a mensagem); só fecha e avisa em caso de sucesso. */
  const inDialog=(action:()=>Promise<unknown>,done:string)=>async()=>{await action();setDlg(null);toast.success(done)};
  const reorderBoard=(direction:-1|1)=>{if(!board||!boards.data)return;const index=boards.data.findIndex(item=>item.id===board.id);const other=boards.data[index+direction];if(!other)return;void run(async()=>{await Promise.all([updateBoard.mutateAsync({boardId:board.id,position:other.position}),updateBoard.mutateAsync({boardId:other.id,position:board.position})])})};
  const reorder=(column:KanbanColumn,direction:-1|1)=>{if(!board)return;const index=board.columns.findIndex(item=>item.id===column.id);const other=board.columns[index+direction];if(!other)return;void run(async()=>{await Promise.all([updateColumn.mutateAsync({columnId:column.id,position:other.position}),updateColumn.mutateAsync({columnId:other.id,position:column.position})])})};
  const move=(cardId:string,columnId:string,position?:number)=>run(()=>moveCard.mutateAsync({cardId,columnId,position}));
  const openNewBoard=()=>setDlg({kind:'board-new'});
  if(boards.isLoading)return <section className="kanban-page"><LoadingState label="Carregando seus quadros…"/></section>;
  if(boards.isError)return <section className="kanban-page"><ErrorState title="Não foi possível carregar o Kanban." error={boards.error} retry={()=>void boards.refetch()}/></section>;
  const total=board?.columns.reduce((sum,column)=>sum+column.cards.length,0)??0;
  return <section className="kanban-page">
    <header className="kanban-header"><div><span>OPERAÇÕES</span><h1>Kanban</h1><p>Acompanhe os contatos em cada etapa do atendimento.</p></div><div className="kanban-actions">{boards.data?.length?<label>Quadro <span><select value={boardId} onChange={event=>setBoardId(event.target.value)}>{boards.data.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15}/></span></label>:null}{manage&&<button className="primary" onClick={openNewBoard}><Plus size={17}/> Novo quadro</button>}</div></header>
    {error&&<div className="kanban-error" role="alert">{error}<button aria-label="Fechar aviso" onClick={()=>setError('')}>×</button></div>}
    {!board?<EmptyState title="Organize seu atendimento por etapas" actionLabel={manage?'Criar primeiro quadro':undefined} onAction={openNewBoard}>{manage?'Crie o primeiro quadro e adicione colunas como Novo, Em atendimento e Concluído.':'Ainda não há quadros. Peça a um administrador para criar o primeiro.'}</EmptyState>:<>
      <div className="board-toolbar"><div><i/><b>{board.name}</b><span>{plural(total,'cartão','cartões')}</span></div><div><button disabled={board.columns.length===0} title={board.columns.length?undefined:'Crie uma coluna antes de adicionar contatos'} onClick={()=>setDlg({kind:'card-add'})}><UserPlus size={16}/> Adicionar contato</button>{manage&&<><button aria-label="Mover quadro para esquerda" title="Mover quadro para esquerda" disabled={(boards.data?.findIndex(item=>item.id===board.id)??0)===0} onClick={()=>reorderBoard(-1)}><ArrowLeft size={15}/></button><button aria-label="Mover quadro para direita" title="Mover quadro para direita" disabled={(boards.data?.findIndex(item=>item.id===board.id)??0)===(boards.data?.length??1)-1} onClick={()=>reorderBoard(1)}><ArrowRight size={15}/></button><button onClick={()=>setDlg({kind:'board-rename'})}><MoreHorizontal size={17}/> Renomear</button><button onClick={()=>setDlg({kind:'col-new'})}><Plus size={17}/> Coluna</button><button className="danger" onClick={()=>setDlg({kind:'board-delete'})}><Trash2 size={16}/> Excluir quadro</button></>}</div></div>
      <div className="kanban-board" aria-label={`Quadro ${board.name}`}>{board.columns.map((column,index)=><article className="kanban-column" key={column.id} onDragOver={event=>event.preventDefault()} onDrop={(event:DragEvent)=>{event.preventDefault();const cardId=event.dataTransfer.getData('application/nexo-kanban-card')||dragged;if(cardId)void move(cardId,column.id,column.cards.length);setDragged(null)}}>
        <header><span style={{background:column.color}}/><b>{column.name}</b><em>{column.cards.length}</em>{manage&&<div><button disabled={index===0} aria-label="Mover coluna para esquerda" title="Mover para esquerda" onClick={()=>reorder(column,-1)}><ArrowLeft size={14}/></button><button disabled={index===board.columns.length-1} aria-label="Mover coluna para direita" title="Mover para direita" onClick={()=>reorder(column,1)}><ArrowRight size={14}/></button><button aria-label={`Renomear ${column.name}`} title="Renomear" onClick={()=>setDlg({kind:'col-rename',column})}><MoreHorizontal size={16}/></button><button aria-label={`Excluir ${column.name}`} title="Excluir" onClick={()=>setDlg({kind:'col-delete',column})}><Trash2 size={15}/></button></div>}</header>
        <div className="kanban-cards">{column.cards.map((card,position)=>{const label=card.contact.name||card.contact.phone;return <div className={`kanban-card ${dragged===card.id?'dragging':''}`} key={card.id} draggable onDragStart={event=>{event.dataTransfer.setData('application/nexo-kanban-card',card.id);event.dataTransfer.effectAllowed='move';setDragged(card.id)}} onDragEnd={()=>setDragged(null)} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.stopPropagation();event.preventDefault();const id=event.dataTransfer.getData('application/nexo-kanban-card')||dragged;if(id)void move(id,column.id,position);setDragged(null)}}>
          <Link to={card.conversationId?`/inbox?conversation=${card.conversationId}`:`/contacts?search=${encodeURIComponent(card.contact.phone)}`}><b>{label}</b><small>{card.contact.phone}</small></Link>
          {card.contact.tags.length>0&&<div className="card-tags">{card.contact.tags.slice(0,3).map(({tag})=><span key={tag.id}><i style={{background:tag.color}}/>{tag.name}</span>)}</div>}
          <footer><span><Clock3 size={13}/>{elapsed(card.movedAt)} nesta etapa</span><label><span className="sr-only">Mover {label} para</span><select aria-label={`Mover ${label} para outra coluna`} value={column.id} onChange={event=>void move(card.id,event.target.value)}>{board.columns.map(target=><option key={target.id} value={target.id}>{target.name}</option>)}</select></label><button className="card-remove" aria-label={`Remover ${label} do quadro`} title="Remover do quadro" onClick={()=>setDlg({kind:'card-remove',card:{id:card.id,name:label}})}><X size={14}/></button></footer>
        </div>})}{column.cards.length===0&&<p className="column-empty">Nenhum cartão nesta etapa. Arraste um cartão para cá ou use “Adicionar contato”.</p>}</div>
      </article>)}{manage&&board.columns.length===0&&<button className="add-first-column" onClick={()=>setDlg({kind:'col-new'})}><Plus/>Adicionar primeira coluna</button>}</div>
    </>}
    {dlg?.kind==='board-new'&&<NameForm title="Novo quadro" label="Nome do quadro" initial="" submitLabel="Criar quadro" onClose={()=>setDlg(null)} onSubmit={async name=>{const created=await createBoard.mutateAsync({name}) as {id?:string}|undefined;if(created?.id)setBoardId(created.id);setDlg(null);toast.success('Quadro criado.')}}/>}
    {dlg?.kind==='board-rename'&&board&&<NameForm title="Renomear quadro" label="Novo nome do quadro" initial={board.name} submitLabel="Salvar" onClose={()=>setDlg(null)} onSubmit={async name=>{if(name!==board.name)await updateBoard.mutateAsync({boardId:board.id,name});setDlg(null);toast.success('Quadro renomeado.')}}/>}
    {dlg?.kind==='col-new'&&board&&<NameForm title="Nova coluna" label="Nome da coluna" initial="" submitLabel="Criar coluna" onClose={()=>setDlg(null)} onSubmit={async name=>{await createColumn.mutateAsync({boardId:board.id,name,color:palette[board.columns.length%palette.length]!});setDlg(null);toast.success('Coluna criada.')}}/>}
    {dlg?.kind==='col-rename'&&<NameForm title="Renomear coluna" label="Novo nome da coluna" initial={dlg.column.name} submitLabel="Salvar" onClose={()=>setDlg(null)} onSubmit={async name=>{if(name!==dlg.column.name)await updateColumn.mutateAsync({columnId:dlg.column.id,name});setDlg(null);toast.success('Coluna renomeada.')}}/>}
    {dlg?.kind==='board-delete'&&board&&<ConfirmForm title={`Excluir o quadro “${board.name}”`} confirmLabel="Excluir quadro" onClose={()=>setDlg(null)} onConfirm={inDialog(()=>deleteBoard.mutateAsync(board.id),'Quadro excluído.')}><p>O quadro e todos os seus cartões serão excluídos. Os contatos não são apagados. Esta ação não pode ser desfeita.</p></ConfirmForm>}
    {dlg?.kind==='card-remove'&&<ConfirmForm title={`Remover ${dlg.card.name} do quadro`} confirmLabel="Remover cartão" onClose={()=>setDlg(null)} onConfirm={inDialog(()=>removeCard.mutateAsync(dlg.card.id),'Cartão removido.')}><p>Só o cartão sai do quadro; o contato continua na sua base.</p></ConfirmForm>}
    {dlg?.kind==='card-add'&&board&&<AddContactForm board={board} onClose={()=>setDlg(null)} onSubmit={async input=>{await addCard.mutateAsync({boardId:board.id,...input});setDlg(null);toast.success('Contato adicionado ao quadro.')}}/>}
    {dlg?.kind==='col-delete'&&board&&<DeleteColumn column={dlg.column} board={board} onClose={()=>setDlg(null)} onConfirm={async destination=>{await deleteColumn.mutateAsync({columnId:dlg.column.id,destinationColumnId:destination||undefined});setDlg(null);toast.success('Coluna excluída.')}}/>}
  </section>;
}
function DeleteColumn({column,board,onClose,onConfirm}:{column:KanbanColumn;board:KanbanBoard;onClose:()=>void;onConfirm:(destination:string)=>Promise<void>}){
  const [destination,setDestination]=useState('');const [error,setError]=useState<{message:string;flows:Flow[]}|null>(null);const [busy,setBusy]=useState(false);
  return <Dialog title={`Excluir “${column.name}”`} onClose={onClose}>{column.cards.length?<><p>Esta coluna tem {plural(column.cards.length,'cartão','cartões')}. Escolha para onde eles devem ir.</p><label>Coluna de destino<select value={destination} onChange={event=>setDestination(event.target.value)}><option value="" disabled>Selecione…</option>{board.columns.filter(item=>item.id!==column.id).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label></>:<p>A coluna está vazia e será excluída. Esta ação não pode ser desfeita.</p>}<ErrorBox error={error}/><footer><button onClick={onClose}>Cancelar</button><button className="danger" disabled={busy} onClick={async()=>{if(column.cards.length&&!destination){setError({message:'Escolha uma coluna de destino.',flows:[]});return}setBusy(true);setError(null);try{await onConfirm(destination)}catch(caught){setError(kanbanError(caught,'Não foi possível excluir a coluna.'))}finally{setBusy(false)}}}>Excluir coluna</button></footer></Dialog>
}
