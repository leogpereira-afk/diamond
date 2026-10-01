import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {backend,source} from './helpers.mjs';
test('consulta agrupada mantém ordem, separa stores e pagina lotes de cem',async()=>{
 const queries=[];let failure=false;const client={from:table=>{const query={table};const q={select:fields=>{query.fields=fields;return q;},eq:(key,value)=>{query[key]=value;return q;},in:async(key,keys)=>{queries.push({...query,keys});return failure?{error:{message:'offline'}}:{data:keys.filter(k=>k!=='ausente').reverse().map(key=>({key,valor:{id:key}}))};}};return q;}};
 const c=vm.createContext({createClient:()=>client,Deno:{env:{get:()=>''}}});vm.runInContext(source('supabase/functions/_shared/blobs-shim.mjs').replace(/^import .+;\n/gm,'').replaceAll('export function','function').replaceAll('export const','const')+';globalThis.st=getStore;',c);
 const keys=Array.from({length:203},(_,i)=>'p'+i);const result=await c.st('propostas').getMany([...keys,'ausente']);assert.deepEqual(Array.from(result,r=>r.id),keys);assert.equal(queries.length,3);assert.ok(queries.every(q=>q.store==='propostas'&&q.keys.length<=100));
 await c.st('propostas').getMany([]);assert.equal(queries.length,3);failure=true;await assert.rejects(c.st('propostas').getMany(['p0']),/offline/);
});
test('envios carregam em lote sem consultas por registro e mantêm eventos',async()=>{
 const db=backend();for(let i=0;i<83;i++){db.table('envios').set('e'+i,{por:'domo',em:'2026-09-20',cliente:'Cliente '+i});db.table('enviosEv').set('x'+i,{envioId:'e'+i,tipo:'interesse',em:'2026-09-20'});}
 const r=await db.request('listEnvios');assert.equal(r.envios.length,83);assert.equal(r.envios[0].eventos[0].tipo,'interesse');assert.equal(db.reads.filter(n=>['envios','enviosEv'].includes(n)).length,0);
});
test('consulta rápida de reservas entrega unidades pedidos e histórico sem ler CRM ou propostas',async()=>{
 const db=backend();db.table('reservas').set('u-1',{unidadeId:'u-1',cliente:'Ana'});const r=await db.request('reservasPainel',{operacao:'listar'});assert.equal(r.unidades.length,2);assert.equal(r.pedidos[0].cliente,'Ana');assert.deepEqual(r.historico,[]);assert.equal(db.reads.filter(n=>['unidades','reservas','reservas_historico','leads','propostas'].includes(n)).length,0);
});
test('leitura em lote pagina mais de mil registros sem perder a última página',async()=>{
 const rows=Array.from({length:1003},(_,i)=>({key:String(i),valor:{i}}));let queries=0;const client={from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:async(a,b)=>{queries++;return{data:rows.slice(a,b+1)}}};return q;}};
 const c=vm.createContext({createClient:()=>client,Deno:{env:{get:()=>''}}});vm.runInContext(source('supabase/functions/_shared/blobs-shim.mjs').replace(/^import .+;\n/gm,'').replaceAll('export function','function').replaceAll('export const','const')+';globalThis.st=getStore;',c);const r=await c.st('envios').listJSON();assert.equal(r.length,1003);assert.equal(r[1002].valor.i,1002);assert.equal(queries,2);
});
test('reservas abrem sem aguardar sincronização geral e mostram dados atuais do servidor',async()=>{
 const list={innerHTML:'',querySelectorAll:()=>[]};const controls={};const root={isConnected:true,innerHTML:'',querySelector:k=>k==='#rs-list'?list:(controls[k]||={}),querySelectorAll:()=>[]};let fullPull=0;
 const c=vm.createContext({window:{STORE:{pull:async()=>{fullPull++},pullReservas:async()=>{},status:()=>({}),getUnidades:()=>[],getReservas:()=>[],api:async()=>({unidades:[{id:'x',unidade:'606',status:'Reservado',reserva:{cliente:'Atual'}}],pedidos:[],historico:[]})}},document:{querySelector:()=>root},location:{hash:'#/admin/reservas?filtro=incompletas'},Date});vm.runInContext(source('reservas.js'),c);await c.window.DiamondReservas.render();assert.equal(fullPull,0);assert.ok(list.innerHTML.includes('Atual'));assert.ok(list.innerHTML.includes('606'));assert.match(root.innerHTML,/Incompletas <b>1<\/b>/);assert.match(root.innerHTML,/data-rs-filter="ativas" aria-pressed="false">Ativas <b>0<\/b>/);c.location.hash='#/admin/reservas?filtro=ativas';await c.window.DiamondReservas.render();assert.doesNotMatch(list.innerHTML,/Atual/);
});
test('filtro todas mostra cada unidade reservada, sem pedidos nem histórico',async()=>{
 const list={innerHTML:'',querySelectorAll:()=>[]},controls={},root={isConnected:true,innerHTML:'',querySelector:k=>k==='#rs-list'?list:(controls[k]||={}),querySelectorAll:()=>[]};
 const unidades=[{id:'u-401',unidade:'401',status:'Reservado',reserva:{cliente:'Reserva ativa',prazo:'2099-01-01T12:00:00Z'}},{id:'u-402',unidade:'402',status:'Reservado',reserva:{cliente:'Reserva vencida',prazo:'2000-01-01T12:00:00Z'}},{id:'u-403',unidade:'403',status:'Reservado',reserva:{cliente:'Reserva incompleta'}},{id:'u-404',unidade:'404',status:'Disponível'}];let fullPull=0;
 const c=vm.createContext({window:{STORE:{pull:async()=>{fullPull++},pullReservas:async()=>{},status:()=>({}),getUnidades:()=>[],getReservas:()=>[],api:async()=>({unidades,pedidos:[{unidadeId:'u-404',cliente:'Pedido pendente'}],historico:[{unidadeId:'u-402',unidade:'402',em:'2026-01-01T12:00:00Z',acao:'cancelar'}]})}},document:{querySelector:()=>root},location:{hash:'#/admin/reservas?filtro=todas'},Date});
 vm.runInContext(source('reservas.js'),c);await c.window.DiamondReservas.render();assert.equal(fullPull,0);assert.match(root.innerHTML,/Todas as reservas <b>3<\/b>/);assert.ok(list.innerHTML.includes('Reserva ativa'));assert.ok(list.innerHTML.includes('Reserva vencida'));assert.ok(list.innerHTML.includes('Reserva incompleta'));assert.doesNotMatch(list.innerHTML,/Pedido pendente|Histórico/);
});
test('envios em lote preservam isolamento entre empresas e corretores',async()=>{
 const db=backend();db.table('cfg').get('usuarios').push({usuario:'imob',hash:'fake',papel:'corretor',ativo:true,nome:'Maria'});
 db.table('envios').set('privado',{por:'domo',cliente:'Privado'});db.table('envios').set('meu',{por:'imob',corretor:'Maria',cliente:'Meu'});db.table('enviosEv').set('e',{envioId:'privado',tipo:'interesse'});
 const r=await db.request('listEnvios',{},'imob');assert.equal(r.status,200);assert.ok(r.envios.every(e=>e.por==='imob'));assert.ok(!JSON.stringify(r).includes('Privado'));
});
