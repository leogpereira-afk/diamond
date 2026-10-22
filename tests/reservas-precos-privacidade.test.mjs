import test from 'node:test';
import assert from 'node:assert/strict';
import {backend,copy,store} from './helpers.mjs';

const release=(b,id='u-1',operacao='cancelar')=>b.request('reservasPainel',{operacao,unidadeId:id,revisao:b.table('unidades').get(id).atualizadoEm||'',motivo:'Conferência de teste'});
async function reajustar(b,n,percentual=10,modo='reajustar'){
 const args={percentual,modo,dataTabela:'22/10/2026'};
 const p=await b.request('precosPrevia',args,'admin');assert.equal(p.status,200,p.erro);
 const r=await b.request('precosAplicar',{...args,token:p.previa.token,operacaoId:'tabela-teste-'+String(n).padStart(8,'0')},'admin');assert.equal(r.status,200,r.erro);
}
function fixture(options){const b=backend(options);Object.assign(b.table('unidades').get('u-1'),{status:'Reservado',desconto:.1,reserva:{cliente:'Privado'}});return b;}
test('liberação remove desconto e usa os reajustes acumulados enquanto reservada',async()=>{
 const b=fixture();await reajustar(b,1);await reajustar(b,2,5);
 assert.equal(b.table('unidades').get('u-1').precoBase,300000);
 const r=await release(b);assert.equal(r.status,200,r.erro);assert.equal(r.unidade.precoBase,346500);assert.equal(r.unidade.desconto,0);
 const h=[...b.table('reservas_historico').values()].at(-1);assert.equal(h.antes.desconto,.1);assert.equal(h.depois.precoBase,346500);
});
test('preço já reajustado quando disponível não recebe o mesmo reajuste duas vezes',async()=>{
 const b=backend();await reajustar(b,1);Object.assign(b.table('unidades').get('u-1'),{status:'Reservado',desconto:.2});await reajustar(b,2,5);
 const r=await release(b);assert.equal(r.status,200,r.erro);assert.equal(r.unidade.precoBase,346500);assert.equal(r.unidade.desconto,0);
});
test('legado antes e depois da regularização retorna o mesmo preço sem desconto',async()=>{
 for(const regularizar of [false,true]){const b=fixture();b.table('cfg').get('cfg').reajuste=.04;if(regularizar)await reajustar(b,1,4,'regularizar');const r=await release(b);assert.equal(r.status,200,r.erro);const exibido=r.unidade.precoBase*(r.unidade.precoVersao?1:1+(b.table('cfg').get('cfg').reajuste||0));assert.equal(exibido,312000);assert.equal(r.unidade.desconto,0);if(!regularizar){await reajustar(b,1,4,'regularizar');assert.equal(b.table('unidades').get('u-1').precoBase,312000);}}
});
test('histórico incompleto impede liberação em vez de assumir preço antigo',async()=>{
 const b=fixture();await reajustar(b,1);await reajustar(b,2);b.table('precos_historico').delete('tabela-teste-00000001');
 const before=copy(b.table('unidades').get('u-1')),r=await release(b);assert.equal(r.status,409);assert.deepEqual(b.table('unidades').get('u-1'),before);assert.equal(b.table('reservas_historico').size,0);
});
test('mudança de configuração durante liberação recusa toda a operação',async()=>{
 const b=fixture({beforeReservaCommit:({table})=>{table('cfg').get('cfg').reajuste=.2;}});
 const r=await release(b);assert.equal(r.status,409);assert.equal(b.table('unidades').get('u-1').status,'Reservado');assert.equal(b.table('reservas_historico').size,0);
});
test('reabrir venda também volta ao preço de tabela atual e mantém propostas históricas',async()=>{
 const b=backend();b.table('unidades').get('u-2').desconto=.1;await reajustar(b,1);
 const r=await release(b,'u-2','reabrir');assert.equal(r.status,200,r.erro);assert.equal(r.unidade.precoBase,385000);assert.equal(r.unidade.desconto,0);
});
test('corretor recebe apenas identificação pública da reserva; gestão mantém negociação',async()=>{
 const b=fixture();b.table('cfg').get('usuarios').push({usuario:'externo',papel:'corretor',hash:'fake',ativo:true});
 Object.assign(b.table('unidades').get('u-1'),{area:40,andar:1,obs:'Negociação privada',valorNegociado:270000});
 const r=await b.request('list',{},'externo'),u=r.unidades.find(x=>x.id==='u-1');assert.equal(r.status,200);assert.equal(u.precoRestrito,true);assert.equal(u.area,40);
 for(const k of ['precoBase','desconto','reserva','obs','valorNegociado'])assert.equal(u[k],undefined,k);
 for(const user of ['admin','domo'])assert.equal((await b.request('list',{},user)).unidades.find(x=>x.id==='u-1').desconto,.1);
 await release(b);const released=(await b.request('list',{},'externo')).unidades.find(x=>x.id==='u-1');assert.equal(released.precoBase,300000);assert.equal(released.desconto,0);
});
test('cache antigo de reserva não devolve preços para corretor',()=>{
 const {s,mem}=store();s.setUser({usuario:'externo',papel:'corretor'},true);
 mem.set('dv_unidades',JSON.stringify([{id:'u-1',status:'Reservado',precoBase:300000,desconto:.1,obs:'negociação'}]));
 const u=s.getUnidades()[0];assert.equal(u.precoRestrito,true);assert.equal(u.precoBase,undefined);assert.equal(u.desconto,undefined);
});
test('reserva guarda a base normal antes de editar a negociação, mesmo após tabela anterior',async()=>{
 const b=backend();await reajustar(b,1);b.table('unidades').get('u-1').precoBase=340000;
 const u=b.table('unidades').get('u-1');const reserve=await b.request('reservasPainel',{operacao:'reservar',unidadeId:u.id,revisao:u.atualizadoEm,motivo:'Teste',cliente:'Cliente fictício',corretor:'Corretor teste',prazo:'2099-12-31T12:00:00Z'});assert.equal(reserve.status,200,reserve.erro);
 const edited=await b.request('upsert',{unidade:{...reserve.unidade,precoBase:310000,precoTabelaOrigem:{precoBase:1,tabelaId:reserve.unidade.precoVersao}}},'admin');assert.equal(edited.status,200,edited.erro);
 await reajustar(b,2,5);
 const r=await release(b);assert.equal(r.status,200,r.erro);assert.equal(r.unidade.precoBase,357000);
});
test('corretor sincroniza tabela com unidades reservadas e remove preço antigo do cache',async()=>{
 const b=fixture();b.table('cfg').get('usuarios').push({usuario:'externo',papel:'corretor',hash:'fake',ativo:true});await reajustar(b,1);
 const {s,mem}=store(async(_,opts)=>{const p=JSON.parse(opts.body),r=await b.request(p.action,p,'externo');return{ok:r.status===200,status:r.status,json:async()=>r};});
 s.setUser({usuario:'externo',papel:'corretor',senhaHash:'fake'},true);
 mem.set('dv_unidades',JSON.stringify([{id:'u-1',status:'Disponível',precoBase:300000,atualizadoEm:'2099-01-01T00:00:00Z'}]));
 await s.pull();assert.equal(s.status().estado,'ok');assert.equal(s.unidadePorId('u-1').status,'Reservado');assert.equal(s.unidadePorId('u-1').precoBase,undefined);
});
