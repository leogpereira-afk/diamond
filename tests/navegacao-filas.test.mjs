import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source} from './helpers.mjs';

const envCtx=vm.createContext({Date,Intl,URLSearchParams});
vm.runInContext(source('envios-domain.js'),envCtx);
const E=envCtx.DiamondEnviosDomain;

test('rota de Envios lê envio, fila explícita vazia e busca',()=>{
 const r=E.readRoute('#/admin/envios?envio=pp-1&fila=&q=Ana');
 assert.deepEqual({...r},{path:'#/admin/envios',envio:'pp-1',fila:'',filaExplicit:true,q:'Ana'});
});

test('atualização da rota de Envios preserva a query e pode retirar o deep link',()=>{
 assert.equal(E.writeRoute('#/admin/envios?envio=pp-1&fila=pendente',{fila:'',q:'João',dropEnvio:true}),'#/admin/envios?fila=&q=Jo%C3%A3o');
 assert.equal(E.writeRoute('#/admin/envios?envio=pp-1&fila=pendente&q=ana',{dropEnvio:true}),'#/admin/envios?fila=pendente&q=ana');
});

test('Limpar filtros zera os controles visíveis e mantém fila vazia explícita quando havia query',()=>{
 const controls=Object.fromEntries(['q','de','ate','corretor','empresa','modalidade'].map(k=>['#env-'+k,{value:'preenchido'}]));
 const state=E.resetControls({querySelector:k=>controls[k]});
 assert.deepEqual({...state},{fila:'',q:''});
 assert.ok(Object.values(controls).every(x=>x.value===''));
 assert.equal(E.writeRoute('#/admin/envios?fila=pendente&q=ana',{fila:'',q:'',dropEnvio:true}),'#/admin/envios?fila=');
});

test('fila de retorno pendente inclui pendente e contato, mas exclui conclusão',()=>{
 const rows=['pendente','contato','concluido',undefined].map((etapa,i)=>({id:String(i),em:'2026-09-01',acompanhamento:etapa?{etapa}:undefined}));
 assert.deepEqual(E.filter(rows,{fila:'pendente'}).map(x=>x.id).sort(),['0','1']);
});

const reservasCtx=vm.createContext({Date,URLSearchParams,window:{STORE:{}}});
vm.runInContext(source('reservas.js'),reservasCtx);
const R=reservasCtx.window.DiamondReservas;

test('rota de Reservas aceita filtro e unidade por identificador',()=>{
 assert.deepEqual({...R.lerRota('#/admin/reservas?filtro=incompletas&unidade=u-403')},{path:'#/admin/reservas',filtro:'incompletas',unidade:'u-403'});
 assert.equal(R.lerRota('#/admin/reservas?filtro=todas').filtro,'todas');
 assert.equal(R.montarRota({filtro:'vencidas',unidade:'u-403'}),'#/admin/reservas?filtro=vencidas&unidade=u-403');
});

test('reservas ativas, vencidas e incompletas formam estados exclusivos',()=>{
 assert.equal(R.classeReserva({reserva:{prazo:'2099-01-01T00:00:00Z'}}),'ativas');
 assert.equal(R.classeReserva({reserva:{prazo:'2000-01-01T00:00:00Z'}}),'vencidas');
 assert.equal(R.classeReserva({reserva:{}}),'incompletas');
 assert.equal(R.classeReserva({reserva:{prazo:'data inválida'}}),'incompletas');
});
