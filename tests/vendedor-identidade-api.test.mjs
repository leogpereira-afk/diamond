import test from 'node:test';
import assert from 'node:assert/strict';
import {backend,copy} from './helpers.mjs';
const unit={id:'u-401',unidade:'401',status:'Vendido',precoBase:350000,atualizadoEm:'2026-10-01T12:00:00Z',vendedorNome:'José',vendedorEmpresa:'Rede',vendedorUsuario:'equipe-a'};
function setup(){const b=backend();b.table('unidades').set(unit.id,copy(unit));b.table('cfg').get('usuarios').push(...['equipe-a','equipe-b'].map(usuario=>({usuario,nome:'Rede',papel:'corretor',ativo:true,hash:'fake',corretores:[{nome:'José'},{nome:'Maria'}]})));return b;}
const req={unidade:'401',status:'Vendido',vendedorNome:' JOSE ',vendedorEmpresa:'Nome enviado não é autoridade',vendedorUsuario:'equipe-b'};

test('setVendedor diferencia corretores e empresas homônimas pelo login e usa grafia cadastrada',async()=>{
 const b=setup();const r=await b.request('setVendedor',req);assert.equal(r.status,200);assert.equal(r.unidade.vendedorUsuario,'equipe-b');assert.equal(r.unidade.vendedorNome,'José');assert.equal(r.unidade.vendedorEmpresa,'Rede');assert.equal(r.unidade.precoBase,unit.precoBase);
});
test('identidade desconhecida, conta admin/cliente e nome fora da equipe não gravam',async()=>{
 for(const input of [{vendedorUsuario:'ausente'},{vendedorUsuario:'admin'},{vendedorUsuario:'cliente'},{vendedorNome:'Pessoa desconhecida'},{vendedorUsuario:{id:'equipe-b'}}]){const b=setup();const r=await b.request('setVendedor',{...req,...input});assert.equal(r.status,400);assert.deepEqual(b.table('unidades').get(unit.id),unit);}
});
test('somente gestão pode salvar vendedor e o fluxo de reservas continua protegido',async()=>{
 for(const login of ['equipe-a','cliente',null]){const b=setup();assert.equal((await b.request('setVendedor',req,login)).status,403);assert.deepEqual(b.table('unidades').get(unit.id),unit);}
 const b=setup();assert.equal((await b.request('setVendedor',req,'admin')).status,200);b.table('unidades').get(unit.id).status='Reservado';assert.equal((await b.request('setVendedor',req)).status,409);
});
test('edição antiga preserva ID só se nome/equipe não mudaram; opção vazia remove ID',async()=>{
 let b=setup();let r=await b.request('setVendedor',{unidade:'401',status:'Vendido',vendedorNome:'jose',vendedorEmpresa:'rede'});assert.equal(r.status,200);assert.equal(r.unidade.vendedorUsuario,'equipe-a');
 b=setup();r=await b.request('setVendedor',{unidade:'401',status:'Vendido',vendedorNome:'Maria',vendedorEmpresa:'Rede'});assert.equal(r.status,200);assert.ok(!r.unidade.vendedorUsuario);
 b=setup();r=await b.request('setVendedor',{...req,vendedorUsuario:''});assert.equal(r.status,200);assert.ok(!r.unidade.vendedorUsuario);
 b=setup();delete b.table('unidades').get(unit.id).vendedorUsuario;r=await b.request('setVendedor',{unidade:'401',status:'Vendido',vendedorNome:'José',vendedorEmpresa:'Rede'});assert.equal(r.status,200);assert.equal(r.unidade.vendedorUsuario,undefined);
});
test('upsert administrativo valida identidade e elimina vínculo antigo após troca de vendedor',async()=>{
 let b=setup();let r=await b.request('upsert',{unidade:{...unit,vendedorNome:'jose',vendedorUsuario:'equipe-b'}},'admin');assert.equal(r.status,200);assert.equal(r.unidade.vendedorUsuario,'equipe-b');assert.equal(r.unidade.vendedorNome,'José');
 b=setup();r=await b.request('upsert',{unidade:{...unit,vendedorUsuario:'ausente'}},'admin');assert.equal(r.status,400);assert.deepEqual(b.table('unidades').get(unit.id),unit);
 b=setup();r=await b.request('upsert',{unidade:{unidade:'401',status:'Vendido',vendedorNome:'Maria'}},'admin');assert.equal(r.status,200);assert.ok(!r.unidade.vendedorUsuario);
 b=setup();assert.equal((await b.request('upsert',{unidade:{...unit,vendedorUsuario:'equipe-b'}},'domo')).status,403);
});
test('reabrir ou cancelar limpa a identidade antiga sem apagá-la do histórico',async()=>{
 for(const operacao of ['reabrir','cancelar']){const b=setup();if(operacao==='cancelar')Object.assign(b.table('unidades').get(unit.id),{status:'Reservado',reserva:{cliente:'Exemplo',corretor:'José',empresa:'Rede',prazo:'2999-11-01T12:00:00Z'}});
 const r=await b.request('reservasPainel',{operacao,unidadeId:unit.id,revisao:unit.atualizadoEm,motivo:'Exemplo sintético'});assert.equal(r.status,200);assert.ok(!b.table('unidades').get(unit.id).vendedorUsuario);const evento=[...b.table('reservas_historico').values()][0];assert.equal(evento.antes.vendedorUsuario,'equipe-a');}
});
test('prorrogação preserva identidade igual e limpa vínculo se trocar corretor',async()=>{
 for(const corretor of ['jose','Maria']){const b=setup();Object.assign(b.table('unidades').get(unit.id),{status:'Reservado',reserva:{cliente:'Exemplo',corretor:'José',empresa:'Rede',prazo:'2999-11-01T12:00:00Z'}});
 const r=await b.request('reservasPainel',{operacao:'prorrogar',unidadeId:unit.id,revisao:unit.atualizadoEm,motivo:'Exemplo',cliente:'Exemplo',corretor,empresa:'Rede',prazo:'2999-12-01T12:00:00Z'});assert.equal(r.status,200);assert.equal(b.table('unidades').get(unit.id).vendedorUsuario,corretor==='jose'?'equipe-a':undefined);}
});
