import {describe,expect,it} from 'vitest';
import {clampPanelWidth,composerEnabled,endReason,limitWarning,parseVariables,portChoices,simulatorError,skipAction,traceClass,traceOf,type SimView} from './simulator';

const view=(patch:Partial<SimView>={}):SimView=>({messages:[],activeNodeId:null,visitedNodeIds:[],waiting:null,completed:false,...patch});
describe('simulator helpers',()=>{
  it('waiting reply/choice enables the composer; nothing else does',()=>{
    expect(composerEnabled(view({waiting:{kind:'reply',nodeId:'a',canTimeout:false}}))).toBe(true);
    expect(composerEnabled(view({waiting:{kind:'choice',nodeId:'a',options:[],canTimeout:false}}))).toBe(true);
    expect(composerEnabled(view({waiting:{kind:'delay',nodeId:'a',resumeAt:null}}))).toBe(false);
    expect(composerEnabled(view({waiting:{kind:'reply',nodeId:'a',canTimeout:false},completed:true}))).toBe(false);
    expect(composerEnabled(view({waiting:{kind:'reply',nodeId:'a',canTimeout:false},error:{code:'X',message:'m',nodeId:'a'}}))).toBe(false);
    expect(composerEnabled(null)).toBe(false);
  });
  it('skip actions: delay, and timeout only when the block has one',()=>{
    expect(skipAction(view({waiting:{kind:'delay',nodeId:'d',resumeAt:null}}))?.label).toBe('Pular espera');
    expect(skipAction(view({waiting:{kind:'reply',nodeId:'w',canTimeout:true}}))?.label).toBe('Pular para "não respondeu"');
    expect(skipAction(view({waiting:{kind:'reply',nodeId:'w',canTimeout:false}}))).toBeNull();
    expect(skipAction(view({waiting:{kind:'delay',nodeId:'d',resumeAt:null},completed:true}))).toBeNull();
  });
  it('port waits offer only success/failure',()=>{
    expect(portChoices(view({waiting:{kind:'port',nodeId:'i',ports:['success','failure','timeout']}}))).toEqual({nodeId:'i',ports:['success','failure']});
    expect(portChoices(view())).toBeNull();
  });
  it('completion shows the end reason and an error points at the block',()=>{
    const done=view({completed:true,messages:[{id:'1',role:'system',nodeId:null,kind:'end',text:'Transferido para humano',at:''}]});
    expect(endReason(done)).toEqual({tone:'end',text:'Transferido para humano',nodeId:null});
    expect(endReason(view({error:{code:'E',message:'Bloco sem saída',nodeId:'n3'}}))).toEqual({tone:'error',text:'Bloco sem saída',nodeId:'n3'});
    expect(endReason(view())).toBeNull();
  });
  it('maps API error codes to clear messages',()=>{
    expect(simulatorError({code:'SIMULATION_EXPIRED'}).kind).toBe('expired');
    const limit=simulatorError({code:'SIMULATION_LIMIT',status:429});expect(limit.kind).toBe('limit');expect(limit.text).toMatch(/Feche ou reinicie/);
    expect(simulatorError({code:'LIVE_ACTIONS_CONFIRMATION_REQUIRED'}).kind).toBe('confirm');
    expect(simulatorError(new Error('boom'))).toEqual({kind:'other',text:'boom'});
    expect(simulatorError(null).kind).toBe('other');
  });
  it('parses variables as a JSON object only',()=>{
    expect(parseVariables('')).toEqual({ok:true,value:{}});
    expect(parseVariables('{"a":1}')).toEqual({ok:true,value:{a:1}});
    expect(parseVariables('[1]').ok).toBe(false);
    expect(parseVariables('{x').ok).toBe(false);
    expect(parseVariables('null').ok).toBe(false);
  });
  it('trace marks active and visited nodes and leaves untouched classes alone',()=>{
    const trace=traceOf(view({activeNodeId:'b',visitedNodeIds:['a','b']}));
    expect(traceClass(trace,'b')).toBe('sim-active');
    expect(traceClass(trace,'a','has-issue')).toBe('has-issue sim-visited');
    expect(traceClass(trace,'z')).toBeUndefined();
    expect(traceClass(null,'a','has-issue')).toBe('has-issue');
  });
  it('warns near the message cap and clamps the panel width',()=>{
    expect(limitWarning(view({messages:Array.from({length:95},(_,i)=>({id:String(i),role:'bot' as const,nodeId:null,kind:'text' as const,text:'x',at:''}))}))).toMatch(/100/);
    expect(limitWarning(view())).toBeNull();
    expect(clampPanelWidth(100,1400)).toBe(320);expect(clampPanelWidth(900,1400)).toBe(640);expect(clampPanelWidth(500,500)).toBe(420);
  });
});
