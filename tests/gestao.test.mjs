import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source} from './helpers.mjs';

const ctx=vm.createContext({Date,Intl});
vm.runInContext(source('gestao-domain.js'),ctx);
const D=ctx.DiamondGestaoDomain;

test('retorno CRM só vence com data hoje/atrasada; sem data não vira prazo vencido',()=>{
 const leads=[
  {id:'old',estagio:'contato',proximoContato:'2026-09-30'},
  {id:'today',estagio:'novo',proximoContato:'2026-10-01'},
  {id:'future',estagio:'proposta',proximoContato:'2026-10-02'},
  {id:'none',estagio:'contato'},
  {id:'closed',estagio:'fechado',proximoContato:'2026-10-01'},
  {id:'lost',estagio:'perdido',proximoContato:'2026-09-20'},
 ];
 const m=D.build({leads,now:new Date('2026-10-01T15:00:00-03:00')});
 assert.deepEqual(Array.from(m.retornosCRM,x=>x.id),['old','today']);
 assert.equal(D.when('',m.hoje),'sem-data');
 assert.equal(D.when('2026-99-99',m.hoje),'sem-data');
});

test('data ISO é classificada pelo dia de São Paulo, não pelo UTC',()=>{
 const now=new Date('2026-10-01T02:00:00.000Z');
 assert.equal(D.todaySP(now),'2026-09-30');
 assert.equal(D.dateSP('2026-10-01T02:30:00.000Z'),'2026-09-30');
 assert.equal(D.when('2026-10-01','2026-09-30'),'futuro');
 assert.equal(D.when('2026-09-30T23:30:00-03:00','2026-09-30'),'hoje');
});

test('cliente CRM fechado não aumenta vendas; apenas unidades Vendido entram no estoque',()=>{
 const unidades=[{id:'u1',status:'Vendido'},{id:'u2',status:'Disponível'},{id:'u3',status:'Reservado'}];
 const leads=[{id:'l1',estagio:'fechado',unidade:'u2'},{id:'l2',estagio:'fechado',unidade:'fora'}];
 const m=D.build({unidades,leads});
 assert.equal(JSON.stringify(m.estoque),JSON.stringify({disponiveis:1,reservadas:1,vendidas:1,total:3}));
 assert.equal(m.compradores.length,1);
 assert.equal(m.retornosCRM.length,0);
});

test('reservas sem prazo ficam separadas das vencidas e ativas',()=>{
 const unidades=[
  {id:'expired',status:'Reservado',reserva:{prazo:'2026-09-30T22:00:00-03:00'}},
  {id:'active',status:'Reservado',reserva:{prazo:'2026-10-02T12:00:00-03:00'}},
  {id:'missing',status:'Reservado',reserva:{}},
  {id:'invalid',status:'Reservado',reserva:{prazo:'indefinido'}},
 ];
 const m=D.build({unidades,now:new Date('2026-10-01T12:00:00-03:00')});
 assert.deepEqual(Array.from(m.reservas.vencidas,x=>x.id),['expired']);
 assert.deepEqual(Array.from(m.reservas.ativas,x=>x.id),['active']);
 assert.deepEqual(Array.from(m.reservas.semPrazo,x=>x.id),['missing','invalid']);
});

test('envios pendentes sem data entram na fila sem somar com o CRM',()=>{
 const envios=[
  {id:'a',acompanhamento:{etapa:'pendente'}},
  {id:'b',acompanhamento:{etapa:'contato',data:'2026-09-29'}},
  {id:'c',acompanhamento:{etapa:'contato',data:'2026-10-05'}},
  {id:'d',acompanhamento:{etapa:'concluido'}},
 ];
 const m=D.build({envios,leads:[{id:'crm',estagio:'novo',proximoContato:'2026-09-29'}],now:new Date('2026-10-01T12:00:00-03:00')});
 assert.equal(m.totalEnvios,4);
 assert.deepEqual(Array.from(m.retornosEnvios,x=>x.id),['a','b']);
 assert.equal(m.retornosCRM.length,1);
});

test('rotas carregam identificadores e contexto codificados',()=>{
 assert.equal(D.routes.unit('u/a&b','compradores'),'#/conexoes/u%2Fa%26b?voltar=%23%2Fadmin%2Fpainel%3Fvisao%3Dcompradores');
 assert.equal(D.routes.proposal('p&x','relatorios'),'#/proposta/p%26x?voltar=%23%2Fadmin%2Fpainel%3Fvisao%3Drelatorios');
 assert.equal(D.routes.reservation('vencidas','u&1'),'#/admin/reservas?filtro=vencidas&unidade=u%261');
 assert.equal(D.routes.envio('e&x'),'#/admin/envios?envio=e%26x&fila=pendente');
});

test('gráficos reconciliam etapas desconhecidas e estoque sem transformar CRM em venda',()=>{
 const c=D.charts({unidades:[{status:'Vendido'},{status:'Reservado'},{status:'Disponível'},{status:'Bloqueado'}],leads:[{estagio:'fechado'},{estagio:'fechado'},{estagio:'proposta'},{estagio:''}]});
 assert.equal(c.stock.reduce((n,x)=>n+x.value,0),4);
 assert.equal(c.stock.find(x=>x.key==='Vendido').value,1);
 assert.equal(c.stages.reduce((n,x)=>n+x.value,0),4);
 assert.equal(c.stages.find(x=>x.key==='outros').value,1);
});
test('gráfico mensal inclui meses zerados e virada de ano no horário de Brasília',()=>{
 const c=D.charts({now:new Date('2026-02-01T01:00:00Z'),propostas:[{criadoEm:'2025-08-01'},{criadoEm:'2026-02-01T01:30:00Z'},{criadoEm:'2026-02-01T04:00:00Z'},{criadoEm:'2025-07-31'},{criadoEm:'2026-02-30'},{criadoEm:null}]});
 assert.deepEqual(Array.from(c.months,x=>x.key),['2025-08','2025-09','2025-10','2025-11','2025-12','2026-01']);
 assert.deepEqual(Array.from(c.months,x=>x.value),[1,0,0,0,0,1]);
 assert.equal(c.periodTotal,2);assert.equal(c.invalidDates,2);assert.equal(c.futureDates,1);assert.equal(c.outsidePeriod,1);
});
test('ausência de registros mantém os seis meses sem valores fictícios',()=>{
 const c=D.charts({now:new Date('2026-10-01T12:00:00Z')});
 assert.equal(c.months.length,6);assert.equal(c.periodTotal,0);assert.equal(c.stockTotal,0);assert.equal(c.leadsTotal,0);
 assert.equal(c.stages.reduce((n,x)=>n+x.value,0),0);
});
test('gráficos ocultam números de fontes com falha e informam consulta parcial',()=>{
 const win={DiamondGestaoDomain:D};const viewCtx=vm.createContext({window:win,Intl,Date,URLSearchParams});
 const code=source('gestao.js').replace('window.DiamondGestao={render};','window.DiamondGestao={render,visualCharts};');
 vm.runInContext(code,viewCtx);
 const model=D.build({now:new Date('2026-10-01T12:00:00Z'),propostas:[{criadoEm:'2026-10-01'}]});
 const failed=win.DiamondGestao.visualCharts({model,unitsOk:false,leadsOk:false,proposalsOk:false});
 assert.equal((failed.match(/Consulta indisponível/g)||[]).length,4);assert.doesNotMatch(failed,/class="gt-month /);
 const partial=win.DiamondGestao.visualCharts({model,unitsOk:true,leadsOk:true,proposalsOk:true,proposalsComplete:false});
 assert.match(partial,/Leitura parcial/);assert.match(partial,/Propostas não são vendas/);assert.match(partial,/#\/admin\/clientes\?etapa=proposta/);
});
