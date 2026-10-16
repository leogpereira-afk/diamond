import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source} from './helpers.mjs';
const ctx=vm.createContext({Date,window:{STORE:{}}});
vm.runInContext(source('reservas.js'),ctx);
const R=ctx.window.DiamondReservas;
const u={id:'u-401',unidade:'401'},r={cliente:'Ana de Teste',telefone:'(11) 99999-0000'};
const envio={id:'pp-aaaaaaaaaaaaaaaa',unidade:'401',cliente:'ANA DE TESTE',telefone:'5511999990000',em:'2026-10-10T12:00:00Z'};
test('localiza originais por apartamento e nome completo normalizado',()=>{
 const rows=R.pdfsDaReserva([{...envio,cliente:'  Ána de   Teste '}],u,r);
 assert.equal(rows.length,1);assert.equal(rows[0].vinculo,'nome');
});
test('não mistura outros clientes nem outros apartamentos',()=>{
 assert.equal(R.pdfsDaReserva([{...envio,cliente:'Outro cliente'},{...envio,unidade:'1401'},{...envio,cliente:'Ana'}],u,r).length,0);
});
test('telefones divergentes e referências conflitantes não viram o PDF da reserva',()=>{
 assert.equal(R.pdfsDaReserva([{...envio,telefone:'11988880000'}],u,r).length,0);
 assert.equal(R.pdfsDaReserva([{...envio,propostaId:'outra'}],u,{...r,propostaId:'p-certa'}).length,0);
 assert.equal(R.pdfsDaReserva([{...envio,leadId:'outro'}],u,{...r,leadId:'lead-certo'}).length,0);
});
test('vínculo explícito identifica o original mesmo após correção de nome',()=>{
 const rows=R.pdfsDaReserva([{...envio,propostaId:'p-certa',cliente:'Nome anterior'}],u,{...r,propostaId:'p-certa'});
 assert.equal(rows.length,1);assert.equal(rows[0].vinculo,'referencia');
});
test('ordena todas as versões pela data e não altera os registros',()=>{
 const all=[envio,{...envio,id:'pp-bbbbbbbbbbbbbbbb',em:'2026-10-11T12:00:00Z'}];const before=JSON.stringify(all);
 assert.equal(R.pdfsDaReserva(all,u,r)[0].envio.id,'pp-bbbbbbbbbbbbbbbb');assert.equal(JSON.stringify(all),before);
});
test('nome ausente ou link inválido não produz correspondência',()=>{
 assert.equal(R.pdfsDaReserva([envio],u,{}).length,0);
 assert.equal(R.pdfsDaReserva([{...envio,id:'javascript:alert(1)'}],u,r).length,0);
});

function dialogSetup(listEnvios){
 let dialog,session={usuario:'domo'},allowed=true;const listeners=new Map();
 class Element{
  constructor(){this.nodes={};this.isConnected=false;this.open=false;this.handlers={};this.html='';}
  set innerHTML(value){this.html=value;this.nodes={};for(const m of value.matchAll(/id="([^"]+)"/g))this.nodes['#'+m[1]]=new Element();}
  get innerHTML(){return this.html;}
  querySelector(id){return this.nodes[id]||null;}
  setAttribute(){} showModal(){this.open=true;}
  addEventListener(name,fn){this.handlers[name]=fn;}
  close(){this.open=false;this.handlers.close?.();} remove(){this.isConnected=false;}
 }
 const window={P_URL:'https://example.test/dmd-p',STORE:{podeVerPainel:()=>allowed,getUser:()=>session,listEnvios},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const document={querySelector:()=>dialog?.isConnected?dialog:null,createElement:()=>new Element(),body:{append(el){dialog=el;el.isConnected=true;}}};
 const c=vm.createContext({Date,window,document});vm.runInContext(source('reservas.js'),c);
 return{open:()=>c.window.DiamondReservas.abrirPdfs(u,r),dialog:()=>dialog,content:()=>dialog.querySelector('#rs-pdfs-content'),logout:()=>{session=null;},deny:()=>{allowed=false;},listeners};
}
test('consulta abre o original em prévia e não gera outra proposta',async()=>{
 const t=dialogSetup(async()=>[envio]);await t.open();const html=t.content().innerHTML;
 assert.match(html,/pp-aaaaaaaaaaaaaaaa\?pdf=1&amp;preview=1/);
 assert.match(html,/target="_blank" rel="noopener"/);
 assert.match(html,/Ver acompanhamento/);assert.doesNotMatch(html,/Gerar PDF/);
});
test('ausência de PDF e falha de consulta têm respostas distintas e permitem tentar novamente',async()=>{
 const empty=dialogSetup(async()=>[]);await empty.open();assert.match(empty.content().innerHTML,/Nenhum PDF localizado/);
 let fail=true;const t=dialogSetup(async()=>{if(fail)throw Error('rede');return[envio];});await t.open();
 assert.match(t.content().innerHTML,/Não foi possível consultar/);assert.doesNotMatch(t.content().innerHTML,/Nenhum PDF/);
 fail=false;await t.content().querySelector('#rs-pdfs-retry').onclick();assert.match(t.content().innerHTML,/Abrir PDF arquivado/);
});
test('consulta tardia após sair ou fechar não mostra dados da sessão anterior',async()=>{
 for(const action of ['logout','close']){
  let done;const t=dialogSetup(()=>new Promise(res=>{done=res;}));const p=t.open();
  if(action==='logout')t.logout();else t.dialog().close();
  done([envio]);await p;assert.equal(t.dialog().isConnected,false);assert.equal(t.listeners.size,0);
 }
});
test('perfil sem acesso ao painel não consulta documentos',async()=>{
 let count=0;const t=dialogSetup(async()=>{count++;return[envio];});t.deny();await t.open();assert.equal(count,0);assert.equal(t.dialog(),undefined);
});

test('anexo prioriza IDs e normaliza nome somente sem referência',()=>{const ps=[{id:'p1',unidade:'401',cliente:'Nome anterior',leadId:'l1'},{id:'p2',unidade:'401',cliente:'  Ána  de teste '}];assert.equal(R.propostasDaReserva(ps,u,{cliente:'Outro',propostaId:'p1'})[0].id,'p1');assert.equal(R.propostasDaReserva(ps,u,{leadId:'l1'})[0].id,'p1');assert.equal(R.propostasDaReserva(ps,u,r)[0].id,'p2');assert.equal(R.propostasDaReserva(ps,u,{...r,propostaId:'inexistente'}).length,0);assert.equal(R.propostasDaReserva(ps,{unidade:'402'},r).length,0);});
