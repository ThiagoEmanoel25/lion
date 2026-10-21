export function withRuntimeGlobals<T extends Record<string,unknown>>(context:T,globals:Record<string,string>):T{
  const next={...context};delete next.global;
  Object.defineProperty(next,'global',{value:globals,enumerable:false,configurable:true});
  return next;
}
