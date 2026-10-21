import {describe,expect,it} from 'vitest';
import {renderTemplate} from './routing.js';
import {withRuntimeGlobals} from './global-context.js';

describe('runtime global variables',()=>{
  it('resolve a variável sem persistir o segredo no contexto',()=>{
    const context=withRuntimeGlobals({contact:{name:'Ana'}},{token:'segredo',link_grupo:'https://example.test/grupo'});
    expect(renderTemplate('{{global.link_grupo}}',context)).toBe('https://example.test/grupo');
    expect(JSON.stringify(context)).not.toContain('segredo');
    expect(JSON.stringify(context)).not.toContain('link_grupo');
  });

  it('remove um global legado persistido antes de anexar os valores atuais',()=>{
    const context=withRuntimeGlobals({global:{token:'antigo'},value:1},{token:'novo'});
    expect(renderTemplate('{{global.token}}',context)).toBe('novo');
    expect(JSON.parse(JSON.stringify(context))).toEqual({value:1});
  });
});
