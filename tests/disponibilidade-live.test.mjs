import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {backend} from './helpers.mjs';
import {disponibilidadeStream} from '../supabase/functions/dmd-api/disponibilidade-stream.mjs';

test('live endpoint requires a valid session',async()=>{
 const b=backend();
 assert.equal((await b.request('disponibilidadeAoVivo',{},null)).status,403);
 assert.equal((await b.request('disponibilidadeAoVivo',{},'domo')).status,200);
});
test('stream sends only status after subscription and cleans up',async()=>{
 let event,removed=0;
 const channel={on(_name,filter,fn){assert.equal(filter.table,'dmd_disponibilidade');event=fn;return this;},subscribe(fn){queueMicrotask(()=>fn('SUBSCRIBED'));}};
 const abort=new AbortController();const stream=disponibilidadeStream({channel:()=>channel,removeChannel(){removed++;}},abort.signal);
 const reader=stream.getReader(),decode=async()=>JSON.parse(new TextDecoder().decode((await reader.read()).value));
 assert.deepEqual(await decode(),{type:'ready'});
 event({new:{id:'unit-test',status:'Reservado',preco:123,cliente:'private'}});
 assert.deepEqual(await decode(),{type:'unit',id:'unit-test',status:'Reservado'});
 abort.abort();assert.equal((await reader.read()).done,true);assert.equal(removed,1);
});
test('client receives split chunks immediately without timer and stops on logout',async()=>{
 let c,request,session={usuario:'fixture',senhaHash:'fake',papel:'corretor'},timers=[];
 const got=[];let sync=0;
 const context={window:{},AbortController,TextDecoder,JSON,Error,
 setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{},
 fetch:async(url,opts)=>{request={url,opts};return {ok:true,body:new ReadableStream({start(ctrl){c=ctrl;opts.signal.addEventListener('abort',()=>ctrl.close(),{once:true});}})};}};
 vm.runInNewContext(fs.readFileSync(new URL('../disponibilidade-live.js',import.meta.url),'utf8'),context);
 const live=context.window.criarDisponibilidadeLive({url:'/api',token:'fixture',sessao:()=>session,receber:e=>got.push(e),sincronizar:()=>sync++});
 live.restart();await new Promise(r=>setImmediate(r));
 const enc=new TextEncoder();c.enqueue(enc.encode('{"type":"ready"}\n{"type":"unit","id":"u-'));
 c.enqueue(enc.encode('1","status":"Reservado"}\n'));
 await new Promise(r=>setImmediate(r));
 assert.equal(sync,1);assert.equal(got[0].status,'Reservado');
 assert.equal(timers.some(t=>t.ms===30000),false);
 assert.equal(request.url,'/api');assert.equal(JSON.parse(request.opts.body).auth.senhaHash,'fake');
 session=null;live.restart();assert.equal(request.opts.signal.aborted,true);live.stop();
});

test('push purges cached values before any pending request completes',async()=>{
 const {store}=await import('./helpers.mjs');
 const {s,mem,ctx}=store(()=>new Promise(()=>{}));
 s.setUser({usuario:'external-fixture',senhaHash:'fake',papel:'corretor'},true);
 mem.set('dv_unidades',JSON.stringify([{id:'u-test',status:'Disponível',precoBase:330000,desconto:.1}]));
 let live,refresh=0;
 ctx.window.criarDisponibilidadeLive=opts=>{live=opts;return{restart(){}};};
 ctx.window.addEventListener=()=>{};ctx.document={addEventListener(){},hidden:false};ctx.setInterval=()=>0;ctx.setTimeout=()=>0;ctx.clearTimeout=()=>{};
 s.iniciar(()=>refresh++);
 live.receber({type:'unit',id:'u-test',status:'Reservado'});
 const unit=s.unidadePorId('u-test');
 assert.equal(unit.status,'Reservado');assert.equal(unit.precoBase,undefined);assert.equal(unit.desconto,undefined);assert.equal(refresh,1);
});
