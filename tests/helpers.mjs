import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
export const root=new URL('../',import.meta.url);
export const source=p=>fs.readFileSync(new URL(p,root),'utf8');
export const copy=v=>v==null?null:JSON.parse(JSON.stringify(v));
export function backend({failEvent=false}={}){
 const tables=new Map();const table=n=>{if(!tables.has(n))tables.set(n,new Map());return tables.get(n);};
 table('cfg').set('usuarios',[{usuario:'domo',nome:'Domo',hash:'fake',papel:'corretor',ativo:true,corretores:[{nome:'Teste'}]},{usuario:'admin',hash:'fake',papel:'admin',ativo:true},{usuario:'cliente',hash:'fake',papel:'cliente',ativo:true}]);table('cfg').set('cfg',{});
 table('unidades').set('u-1',{id:'u-1',unidade:'1',status:'Disponível',precoBase:300000,obs:'interno'});
 table('unidades').set('u-2',{id:'u-2',unidade:'2',status:'Vendido',precoBase:350000});
 const getStore=n=>({get:async k=>copy(table(n).get(k)),setJSON:async(k,v)=>{if(n==='enviosEv'&&failEvent)throw Error('storage offline');table(n).set(k,copy(v));},insertJSON:async(k,v)=>{if(table(n).has(k))return false;table(n).set(k,copy(v));return true;},delete:async k=>table(n).delete(k),list:async({prefix=''}={})=>({blobs:[...table(n).keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))})});
 const context=vm.createContext({crypto,Buffer,Date,Math,SEED:[],connectLambda:()=>{},getStore,Deno:{env:{get:k=>k==='DMD_TOKEN'?'fake-gate':undefined}}});
 const load=p=>{const code=source(p).replace(/^import .+;\n/gm,'').replace('export const handler','const handler');const c=vm.createContext({...context});vm.runInContext(code+';globalThis.testHandler=handler;',c);return c.testHandler;};
 const api=load('supabase/functions/dmd-api/api-core.mjs'),pub=load('supabase/functions/dmd-p/p-core.mjs');
 return {table,request:async(action,body={},user='domo')=>{const r=await api({httpMethod:'POST',headers:{'x-token':'fake-gate'},body:JSON.stringify({action,...body,...(user?{auth:{usuario:user,senhaHash:'fake'}}:{})})});return {status:r.statusCode,...JSON.parse(r.body)};},pub:async(body={},query={})=>{const r=await pub({httpMethod:'POST',path:'/pp-aaaaaaaaaaaaaaaa',headers:{},queryStringParameters:query,body:JSON.stringify(body)});return {status:r.statusCode,...JSON.parse(r.body)};}};
}
export function store(fetchImpl){const mem=new Map();const storage={getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,v),removeItem:k=>mem.delete(k)};
 const ctx=vm.createContext({window:{API_BASE:'https://fake.invalid',APP_TOKEN:'fake'},localStorage:storage,sessionStorage:storage,navigator:{onLine:true},Date,Math,fetch:fetchImpl,AbortController,setTimeout,clearTimeout});vm.runInContext(source('store.js'),ctx);const s=ctx.window.STORE;s.setUser({usuario:'domo',senhaHash:'fake',papel:'corretor',corretorAtivo:{nome:'Teste'}},true);return{s,mem,ctx};}
export function appTools(code=source('app.js')){const c=vm.createContext({window:{},Date,Math,STORE:{}});vm.runInContext(code.slice(0,code.lastIndexOf("  window.addEventListener('hashchange'"))+";globalThis.testApp={fmtData,scpCalcular"+(code.includes('function scpProposta')?',scpProposta':'')+"};})();",c);return c.testApp;}
