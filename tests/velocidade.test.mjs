import test from 'node:test';
import assert from 'node:assert/strict';
import {backend,store} from './helpers.mjs';

for(const [action,collection,field] of [['list','unidades','unidades'],['listPropostas','propostas','propostas'],['listLeads','leads','leads'],['listReservas','reservas','reservas']]) {
 test(`${action}: 83 registros sem uma consulta individual por registro`,async()=>{
  const db=backend();db.table(collection).clear();
  for(let i=0;i<83;i++)db.table(collection).set('item-'+i,{id:'item-'+i,unidade:String(i),cliente:'Teste '+i});
  const r=await db.request(action);assert.equal(r.status,200);assert.equal(r[field].length,83);
  assert.equal(db.reads.filter(n=>n===collection).length,0);
 });
}
test('paginação mantém 203 propostas sem perder ou repetir registros',async()=>{
 const db=backend();for(let i=0;i<203;i++)db.table('propostas').set('p-'+i,{id:'p-'+i});
 let after=null,ids=[];do{const r=await db.request('listPropostas',{after});assert.equal(r.total,203);ids.push(...r.propostas.map(p=>p.id));after=r.nextAfter;}while(after);
 assert.equal(ids.length,203);assert.equal(new Set(ids).size,203);
});
test('leituras simultâneas compartilham a rede, mas gravações continuam independentes',async()=>{
 let calls=0,finish;const ready=new Promise(r=>finish=r);
 const {s}=store(async()=>{calls++;await ready;return{ok:true,json:async()=>({leads:[{id:'um'}]})};});
 const first=s.api('listLeads',{comoCorretor:'Teste'}),second=s.api('listLeads',{comoCorretor:'Teste'});
 const initialCalls=calls;finish();const [a,b]=await Promise.all([first,second]);assert.equal(initialCalls,1);a.leads[0].id='mudou';assert.equal(b.leads[0].id,'um');
 await s.api('listLeads',{comoCorretor:'Teste'});assert.equal(calls,2);
 await Promise.all([s.api('upsertLead',{lead:{id:'um'}}),s.api('upsertLead',{lead:{id:'um'}})]);assert.equal(calls,4);
});
test('leituras de corretores diferentes não são compartilhadas; falha permite tentar novamente',async()=>{
 let calls=0;const {s}=store(async()=>{calls++;throw Error('falha');});
 await Promise.allSettled([s.api('listLeads',{comoCorretor:'Ana'}),s.api('listLeads',{comoCorretor:'Bia'})]);assert.equal(calls,2);
 await assert.rejects(s.api('listLeads',{comoCorretor:'Ana'}),/falha/);assert.equal(calls,3);
});
test('sincronização grava listas em lote, preserva edição local recente e exclui ausentes',async()=>{
 const list=Array.from({length:150},(_,i)=>({id:'r'+i,atualizadoEm:'2026-01-01'}));
 const {s,mem,ctx}=store(async(_,opts)=>{const a=JSON.parse(opts.body).action;return{ok:true,json:async()=>a==='list'?{unidades:list}:a==='getCfg'?{cfg:{}}:a==='listPropostas'?{propostas:list}:a==='listLeads'?{leads:list}:{reservas:[]}};});
 mem.set('dv_leads',JSON.stringify([{id:'r1',cliente:'Edição local',atualizadoEm:'2099-01-01'},{id:'ausente',atualizadoEm:'2020-01-01'}]));
 const writes={};const save=ctx.localStorage.setItem;ctx.localStorage.setItem=(k,v)=>{writes[k]=(writes[k]||0)+1;save(k,v);};
 await s.pull();assert.equal(s.getLeads().length,150);assert.equal(s.getLeads().find(l=>l.id==='r1').cliente,'Edição local');
 assert.equal(s.getPropostas().length,150);assert.equal(s.getUnidades().length,150);
 for(const k of ['dv_leads','dv_propostas','dv_unidades'])assert.ok(writes[k]<=2,`${k}: ${writes[k]} gravações`);
});
test('atualizações simultâneas dividem um ciclo e consultam fontes independentes em paralelo',async()=>{
 let release;const gate=new Promise(r=>release=r),called=[];
 const {s}=store(async(_,opts)=>{const a=JSON.parse(opts.body).action;called.push(a);await gate;return{ok:true,json:async()=>a==='list'?{unidades:[]}:a==='getCfg'?{cfg:{}}:a==='listPropostas'?{propostas:[]}:a==='listLeads'?{leads:[]}:{reservas:[]}};});
 const a=s.pull(),b=s.pull();const started=called.slice();release();await Promise.all([a,b]);
 assert.equal(new Set(started).size,5);assert.equal(called.length,5);assert.equal(s.status().estado,'ok');
});
test('resposta de uma sessão anterior não repõe seus dados após troca de usuário',async()=>{
 let release;const gate=new Promise(r=>release=r);
 const {s,mem}=store(async(_,opts)=>{const a=JSON.parse(opts.body).action;await gate;return{ok:true,json:async()=>a==='list'?{unidades:[{id:'antigo'}]}:a==='getCfg'?{cfg:{}}:a==='listPropostas'?{propostas:[]}:a==='listLeads'?{leads:[{id:'antigo'}]}:{reservas:[]}};});
 const job=s.pull();s.setUser({usuario:'outro',senhaHash:'outro',papel:'cliente'},true);release();await job;
 assert.equal(s.getUnidades().length,0);assert.equal(s.getLeads().length,0);assert.equal(mem.has('dv_lastsync'),false);
});
