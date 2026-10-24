import vm from 'node:vm';
import assert from 'node:assert/strict';
import {store,source} from './helpers.mjs';
import {test} from 'node:test';
test('offline e reconexão ocultam valores até validar; reserva bloqueia e disponibilidade libera',async()=>{
let online=true,hold=false,release;
let remote={id:'fixture',status:'Disponível',precoBase:330000,atualizadoEm:'2026-10-20T00:00:00Z'};
const {s,ctx}=store(async(_url,opts)=>{
 if(!online)throw Error('simulated network failure');
 if(hold)await new Promise(r=>release=r);
 const {action}=JSON.parse(opts.body);
 const data=action==='list'?{unidades:[remote]}:action==='getCfg'?{cfg:{atualizadoEm:'2026-10-20T00:00:00Z'}}:action==='listPropostas'?{propostas:[]}:action==='listReservas'?{reservas:[]}:{leads:[]};
 return{ok:true,json:async()=>structuredClone(data)};
});
const handlers={};ctx.window.addEventListener=(name,fn)=>handlers[name]=fn;ctx.document={hidden:false,addEventListener(){}};ctx.setInterval=()=>0;
let live;
ctx.window.criarDisponibilidadeLive=options=>{live=options;return{restart(){}};};
const screen={innerHTML:'VALOR R$ 330.000'};
const ui=vm.createContext({STORE:s,location:{hash:'#/sim/fixture'},sim:{},_uniDraft:{},_sujo:true,document:{querySelectorAll:()=>[]},app:()=>screen});
const app=source('app.js'),start=app.indexOf('  function bloquearSimuladorIndisponivel()'),end=app.indexOf("\n  window.addEventListener('hashchange'",start);
vm.runInContext(app.slice(start,end),ui);
const refresh=()=>{if(!ui.bloquearSimuladorIndisponivel())screen.innerHTML='VALOR '+s.unidadePorId('fixture')?.precoBase;};s.on('sync',refresh);s.iniciar(refresh);
await s.pull();assert.equal(s.unidadePorId('fixture').status,'Disponível');
online=false;ctx.navigator.onLine=false;handlers.offline?.();
remote={id:'fixture',status:'Reservado',precoRestrito:true,atualizadoEm:'2026-10-21T00:00:00Z'};
assert.match(screen.innerHTML,/Conferindo disponibilidade/);assert.doesNotMatch(screen.innerHTML,/330000|330.000/);
online=true;ctx.navigator.onLine=true;
// Hold the status response while independent lookups can finish.
const previousFetch=ctx.fetch;let unlock;const gate=new Promise(r=>unlock=r);
ctx.fetch=async(url,opts)=>{if(JSON.parse(opts.body).action==='list')await gate;return previousFetch(url,opts);};
handlers.online();
assert.match(screen.innerHTML,/Conferindo disponibilidade/);assert.doesNotMatch(screen.innerHTML,/330000|330.000/);
unlock();await s.pull();
assert.match(screen.innerHTML,/Unidade indisponível/);assert.equal(s.unidadePorId('fixture').precoBase,undefined);

online=false;ctx.navigator.onLine=false;handlers.offline();
assert.match(screen.innerHTML,/Conferindo disponibilidade/);
remote={id:'fixture',status:'Disponível',precoBase:352000,desconto:0,atualizadoEm:'2026-10-22T00:00:00Z'};
online=true;ctx.navigator.onLine=true;handlers.online();await s.pull();
assert.equal(s.disponibilidadeConfirmada(),true);assert.match(screen.innerHTML,/352000/);
// Browser may report online while the endpoint remains unreachable.
online=false;handlers.online();await s.pull();
assert.equal(s.disponibilidadeConfirmada(),false);assert.match(screen.innerHTML,/Conferindo disponibilidade/);
});

