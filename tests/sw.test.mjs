import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {source} from './helpers.mjs';
test('arquivos da versão instalada abrem do cache, mas HTML e API continuam atuais',async()=>{
 const code=source('sw.js'),version=code.match(/diamond-pages-v(\d+)/)[1],events={},fetched=[],puts=[];
 const base='https://leogpereira-afk.github.io/diamond/';
 const cached=new Response('instalado');let hasCache=true;
 const cache={match:async()=>hasCache?cached.clone():undefined,put:async(r)=>puts.push(r.url)};
 const c=vm.createContext({URL,Response,self:{location:{href:base+'sw.js',origin:'https://leogpereira-afk.github.io'},addEventListener:(e,fn)=>events[e]=fn},caches:{open:async()=>cache,match:cache.match},fetch:async r=>{fetched.push(r.url);return new Response('rede');}});vm.runInContext(code,c);
 const request=async path=>{let result;events.fetch({request:{url:new URL(path,base).href,method:'GET'},respondWith:p=>result=p,waitUntil:()=>{}});return result;};
 assert.equal(await(await request('app.js?v='+version)).text(),'instalado');assert.equal(fetched.length,0);
 assert.equal(await(await request('index.html')).text(),'rede');assert.equal(fetched.length,1);
 assert.equal(await request('https://projeto.supabase.co/functions/v1/dmd-api'),undefined);
 hasCache=false;assert.equal(await(await request('styles.css?v='+version)).text(),'rede');assert.equal(fetched.length,2);
 assert.equal(await(await request('app.js?v=999999')).text(),'rede');assert.equal(fetched.length,3);
});
test('atualizacao do Diamond preserva caches de outros sistemas',async()=>{const events={},removed=[];const c=vm.createContext({self:{addEventListener:(e,fn)=>events[e]=fn,clients:{claim:async()=>{}}},caches:{keys:async()=>['diamond-pages-v1','impresilk-compras-v15','rh-cache-v2'],delete:async k=>removed.push(k)}});vm.runInContext(source('sw.js'),c);let done;events.activate({waitUntil:p=>done=p});await done;assert.deepEqual(removed,['diamond-pages-v1']);});
