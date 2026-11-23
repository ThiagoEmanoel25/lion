import {describe,it,expect,vi} from 'vitest';
import {assertRuntimeConfig,resolveCorsOrigin,RuntimeConfigError} from '@nexo/config';
const key=(n:number)=>Buffer.alloc(n,7).toString('base64');
const good=()=>({NODE_ENV:'production',DATABASE_URL:'postgresql://u:p@h/db',REDIS_URL:'redis://h:6379',JWT_SECRET:'x'.repeat(40),FIELD_ENCRYPTION_KEY:key(32),WEB_ORIGIN:'https://a.example.com',PUBLIC_API_URL:'https://a.example.com/api'});
const fails=(env:any)=>{try{assertRuntimeConfig(env);return null}catch(e){expect(e).toBeInstanceOf(RuntimeConfigError);return (e as Error).message}};
describe('assertRuntimeConfig',()=>{
  it('produção correta passa',()=>{expect(fails(good())).toBeNull()});
  for(const k of ['DATABASE_URL','REDIS_URL','JWT_SECRET','FIELD_ENCRYPTION_KEY','WEB_ORIGIN','PUBLIC_API_URL'])
    it(`ausente ${k} falha e é listada`,()=>{const e:any=good();delete e[k];expect(fails(e)).toContain(k+':')});
  it('placeholders e valores fracos',()=>{
    expect(fails({...good(),JWT_SECRET:'replace-with-at-least-32-characters'})).toContain('JWT_SECRET');
    expect(fails({...good(),JWT_SECRET:'curto'})).toContain('JWT_SECRET');
    expect(fails({...good(),FIELD_ENCRYPTION_KEY:'replace-with-32-byte-base64-key'})).toContain('FIELD_ENCRYPTION_KEY');
  });
  it('chave com 31 ou 33 bytes falha; não-base64 falha',()=>{
    expect(fails({...good(),FIELD_ENCRYPTION_KEY:key(31)})).toContain('FIELD_ENCRYPTION_KEY');
    expect(fails({...good(),FIELD_ENCRYPTION_KEY:key(33)})).toContain('FIELD_ENCRYPTION_KEY');
    expect(fails({...good(),FIELD_ENCRYPTION_KEY:'não é base64!'})).toContain('FIELD_ENCRYPTION_KEY');
  });
  it('URLs não-https falham',()=>{
    const m=fails({...good(),WEB_ORIGIN:'http://a.com',PUBLIC_API_URL:'lixo'})!;
    expect(m).toContain('WEB_ORIGIN');expect(m).toContain('PUBLIC_API_URL');
  });
  it('lista TODAS as erradas e não imprime valores secretos',()=>{
    const m=fails({NODE_ENV:'production',JWT_SECRET:'segredo-curto-xyz',FIELD_ENCRYPTION_KEY:'abc-secret'})!;
    for(const k of ['DATABASE_URL','REDIS_URL','JWT_SECRET','FIELD_ENCRYPTION_KEY','WEB_ORIGIN','PUBLIC_API_URL'])expect(m).toContain(k);
    expect(m).not.toContain('segredo-curto-xyz');expect(m).not.toContain('abc-secret');
  });
  it('desenvolvimento e teste só avisam',()=>{
    for(const NODE_ENV of ['development','test',undefined]){const warn=vi.fn();expect(()=>assertRuntimeConfig({NODE_ENV,JWT_SECRET:'curto'},{warn})).not.toThrow();expect(warn).toHaveBeenCalledOnce()}
    const warn=vi.fn();assertRuntimeConfig(good() as any,{warn});expect(warn).not.toHaveBeenCalled();
  });
});
describe('resolveCorsOrigin',()=>{
  it('produção sem WEB_ORIGIN falha',()=>{expect(()=>resolveCorsOrigin({NODE_ENV:'production'})).toThrow(/WEB_ORIGIN/)});
  it('dev usa fallback localhost',()=>{expect(resolveCorsOrigin({})).toBe('http://localhost:5173')});
  it('aceita um valor ou lista por vírgula',()=>{
    expect(resolveCorsOrigin({NODE_ENV:'production',WEB_ORIGIN:'https://a.com'})).toBe('https://a.com');
    expect(resolveCorsOrigin({NODE_ENV:'production',WEB_ORIGIN:'https://a.com, https://b.com'})).toEqual(['https://a.com','https://b.com']);
  });
});
