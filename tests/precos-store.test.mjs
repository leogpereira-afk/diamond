import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {store,source} from './helpers.mjs';
const ok=x=>({ok:true,json:async()=>x});
test('nova tabela só entra no cache depois da confirmação da nuvem',async()=>{
 let libera; const{s,mem}=store(async()=>new Promise(r=>{libera=r}));mem.set('dv_cfg',JSON.stringify({versao:'v1'}));mem.set('dv_unidades',JSON.stringify([{id:'u-1',precoBase:100}]));
 const pendente=s.aplicarTabelaPrecos({operacaoId:'abc'});assert.equal(s.getCfg().versao,'v1');
 libera(ok({ok:true,cfg:{versao:'v2',reajuste:0},unidades:[{id:'u-1',precoBase:104,precoVersao:'abc'}]}));await pendente;
 assert.equal(s.getCfg().versao,'v2');assert.equal(s.getUnidades()[0].precoBase,104);
});
test('falha ao aplicar mantém os dados anteriores',async()=>{const{s,mem}=store(async()=>{throw Error('sem rede')});mem.set('dv_cfg',JSON.stringify({versao:'v1'}));await assert.rejects(s.aplicarTabelaPrecos({}),/sem rede/);assert.equal(s.getCfg().versao,'v1');});
test('edição de unidade pendente bloqueia reajuste',async()=>{let calls=0;const{s,mem}=store(async()=>{calls++;return ok({})});mem.set('dv_fila',JSON.stringify([{action:'upsert',unidade:{id:'u-1'}}]));await assert.rejects(s.aplicarTabelaPrecos({}),/sincronização/);assert.equal(calls,0);});
test('preço materializado não recebe multiplicador legado nem perde aumento após reserva',()=>{const code=source('app.js');const line=code.match(/const valorTabela =[^\n]+/)[0];const c=vm.createContext({});vm.runInContext(line+';globalThis.calc=valorTabela;',c);for(const status of ['Disponível','Reservado','Vendido'])assert.equal(c.calc({precoBase:104,precoVersao:'v2',status},{reajuste:.04}),104);});
test('sincronização repete leituras que atravessam uma mudança de tabela',async()=>{
 let cfgReads=0;const{s}=store(async(_,opts)=>{const a=JSON.parse(opts.body).action;
 if(a==='list')return ok({unidades:[{id:'u-1',precoBase:104,precoVersao:'nova'}]});
 if(a==='getCfg'){cfgReads++;return ok({cfg:cfgReads===1?{versao:'v1',reajuste:.04}:{versao:'v2',reajuste:0,tabelaId:'nova'}});}
 return ok({propostas:[],leads:[],reservas:[]});});
 await s.pull();assert.equal(cfgReads,2);assert.equal(s.getCfg().versao,'v2');assert.equal(s.getUnidades()[0].precoBase,104);assert.equal(s.status().estado,'ok');
});
test('conflito autoritativo de preço substitui o cache mesmo com relógio do aparelho adiantado',async()=>{
 const{s,mem}=store(async()=>ok({conflito:true,servidor:{id:'u-1',precoBase:104,precoVersao:'v2',atualizadoEm:'2026-10-05'}}));
 mem.set('dv_unidades',JSON.stringify([{id:'u-1',precoBase:100,atualizadoEm:'2099-01-01'}]));mem.set('dv_fila',JSON.stringify([{action:'upsert',unidade:{id:'u-1',precoBase:100,atualizadoEm:'2099-01-01'}}]));
 await s.trySync();assert.equal(s.getUnidades()[0].precoBase,104);assert.equal(s.filaGet().length,0);
});
test('falha parcial preserva o par de preços e configuração já carregado',async()=>{
 const{s,mem}=store(async(_,opts)=>{const a=JSON.parse(opts.body).action;if(a==='list')throw Error('consulta falhou');if(a==='getCfg')return ok({cfg:{versao:'v2',reajuste:0,tabelaId:'nova'}});return ok({propostas:[],leads:[],reservas:[]});});
 mem.set('dv_cfg',JSON.stringify({versao:'v1',reajuste:.04}));mem.set('dv_unidades',JSON.stringify([{id:'u-1',precoBase:100}]));await s.pull();assert.equal(s.getCfg().versao,'v1');assert.equal(s.getUnidades()[0].precoBase,100);assert.equal(s.status().estado,'erro');
});
test('revisão financeira remota prevalece sobre relógio local adiantado',async()=>{
 const{s,mem}=store(async(_,opts)=>{const a=JSON.parse(opts.body).action;if(a==='list')return ok({unidades:[{id:'u-1',precoBase:104,precoVersao:'nova',atualizadoEm:'2026-10-05'}]});if(a==='getCfg')return ok({cfg:{versao:'v2',reajuste:0,tabelaId:'nova'}});return ok({propostas:[],leads:[],reservas:[]});});
 mem.set('dv_cfg',JSON.stringify({versao:'v1',reajuste:.04}));mem.set('dv_unidades',JSON.stringify([{id:'u-1',precoBase:100,atualizadoEm:'2099-01-01'}]));await s.pull();assert.equal(s.getCfg().versao,'v2');assert.equal(s.getUnidades()[0].precoBase,104);assert.equal(s.getUnidades()[0].precoVersao,'nova');
});
