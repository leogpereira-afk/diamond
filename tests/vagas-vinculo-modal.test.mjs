import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source,copy} from './helpers.mjs';

function fixture({pausarPrimeiraConsulta=false}={}){
 let dialog=null,user={usuario:'admin',senhaHash:'sessao-a'},reads=0,saves=0,callbacks=0,resolveRead;
 const readGate=pausarPrimeiraConsulta?new Promise(r=>resolveRead=r):Promise.resolve();
 const snapshot={ok:true,revisao:5,unidade:{id:'u-401',unidade:'401',status:'Disponível',atualizadoEm:'rev-unidade',precoBase:350000},estado:{vagas:[1,26,52].map((n,i)=>({numero:n,codigo:'V'+String(n).padStart(2,'0'),piso:i,apartamento:'',cliente:'',situacao:'disponivel',alertas:[],avisos:[],origem:{gestao:{},vinculos:[]},assinatura:'origem'})),unidades:[{apartamento:'Apto 401'}],fonte:{},historico:[]}};
 class Element{
  constructor(tag){this.tag=tag;this.disabled=false;this.hidden=false;this.isConnected=false;this.value='';this.nodes=new Map();this.listeners={};}
  set innerHTML(html){this.html=html;this.nodes=new Map();for(const m of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)){const e=new Element(m[1]);e.id=m[2];e.disabled=/\bdisabled\b/.test(m[0]);this.nodes.set('#'+e.id,e);}if(html.includes('cc-close'))this.nodes.set('.cc-close',new Element('button'));if(html.includes('cc-loading'))this.nodes.set('.cc-loading',new Element('div'));const select=this.nodes.get('#vv-vaga');if(select){select.options=[...html.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(m=>({value:m[1],selected:m[2].includes('selected')}));select.value=select.options.find(o=>o.selected)?.value||'';}const form=this.nodes.get('#vv-form');if(form){form.querySelectorAll=s=>this.querySelectorAll(s);form.reportValidity=()=>!!select?.value;}}
  get innerHTML(){return this.html||'';}
  querySelector(s){return this.nodes.get(s)||null;}
  querySelectorAll(s){return s==='a'?[]:[...this.nodes.values()].filter(e=>s.split(',').includes(e.tag));}
  setAttribute(k,v){this[k]=v;}
  addEventListener(k,fn){this.listeners[k]=fn;}
  append(){}
  showModal(){this.isConnected=true;}
  close(){this.open=false;}
  remove(){this.isConnected=false;}
  focus(){}
 }
 const document={activeElement:{focus(){}},body:{append(e){dialog=e;e.isConnected=true;}},createElement:tag=>new Element(tag),querySelector:s=>s==='#vaga-vinculo'&&dialog?.isConnected?dialog:null};
 const ctx=vm.createContext({window:{},document,Date,structuredClone,STORE:{getUser:()=>user,podeVerPainel:()=>!!user,api:async(action,p)=>{assert.equal(action,'vagas');if(p.operacao==='carregar'){reads++;if(reads===1)await readGate;return copy(snapshot);}assert.equal(p.operacao,'vincularUnidade');saves++;if(p.revisao!==snapshot.revisao){const e=Error('Espelho alterado');e.status=409;throw e;}assert.equal(p.unidadeRevisao,'rev-unidade');assert.equal(p.unidadeId,'u-401');const v=snapshot.estado.vagas.find(v=>v.codigo===p.codigo);assert.ok(v);v.apartamento='Apto 401';snapshot.revisao++;return copy(snapshot);}}});
 vm.runInContext(source('vagas-domain.js'),ctx);vm.runInContext(source('vagas-vinculo.js'),ctx);
 return{open:()=>ctx.window.DiamondVagaVinculo.abrir({unidadeId:'u-401',onSaved:()=>callbacks++}),dialog:()=>dialog,snapshot,select:code=>dialog.querySelector('#vv-vaga').value=code,submit:()=>dialog.querySelector('#vv-form').onsubmit({preventDefault(){}}),reads:()=>reads,saves:()=>saves,callbacks:()=>callbacks,release:()=>resolveRead?.(),session:u=>user=u};
}

test('vínculo oferece os três pavimentos numéricos e salva vaga sem enviar preço comprador ou status',async()=>{
 const f=fixture();await f.open();const html=f.dialog().innerHTML;assert.match(html,/Térreo/);assert.match(html,/2º pavimento/);assert.match(html,/3º pavimento/);assert.deepEqual(f.dialog().querySelector('#vv-vaga').options.map(o=>o.value),['','V01','V26','V52']);f.select('V26');await f.submit();assert.equal(f.saves(),1);assert.equal(f.snapshot.unidade.status,'Disponível');assert.equal(f.snapshot.unidade.precoBase,350000);assert.equal(f.callbacks(),1);assert.equal(f.dialog().isConnected,false);
});

test('apartamento com vínculo existente impede segunda associação e direciona para garagem',async()=>{
 const f=fixture();f.snapshot.estado.vagas[0].apartamento='Apto 401';await f.open();assert.equal(f.dialog().querySelector('#vv-save').disabled,true);assert.match(f.dialog().innerHTML,/#\/admin\/vagas\?vaga=V01/);assert.equal(f.saves(),0);
});

test('vaga livre estrutural de outro apartamento não aparece na escolha',async()=>{
 const f=fixture();f.snapshot.estado.vagas[0].apartamento='Apto 402';await f.open();assert.deepEqual(f.dialog().querySelector('#vv-vaga').options.map(o=>o.value),['','V26','V52']);
});

test('conflito conserva vaga selecionada mas exige novo clique, sem repetir gravação automaticamente',async()=>{
 const f=fixture();await f.open();f.select('V26');f.snapshot.revisao++;f.snapshot.estado.unidades[0].status='Reservada';await f.submit();assert.equal(f.saves(),0);assert.equal(f.callbacks(),0);assert.equal(f.dialog().querySelector('#vv-vaga').value,'V26');assert.match(f.dialog().innerHTML,/Confira antes de salvar novamente/);await f.submit();assert.equal(f.saves(),1);assert.equal(f.callbacks(),1);
});

test('consulta tardia de uma sessão anterior não deve mostrar seus dados na sessão nova',async()=>{
 const f=fixture({pausarPrimeiraConsulta:true}),opened=f.open();f.session({usuario:'outra-equipe',senhaHash:'sessao-b'});f.release();await opened;assert.equal(f.dialog().isConnected&&f.dialog().innerHTML.includes('Apartamento 401'),false,'Resposta da sessão anterior não deve reaparecer após troca de equipe');assert.equal(f.saves(),0);
});

test('sincronização sem mudança relevante usa revisão fresca sem pedir outro clique',async()=>{const f=fixture();await f.open();f.select('V26');f.snapshot.revisao++;f.snapshot.estado.unidades[0]['contador de dias']='29';await f.submit();assert.equal(f.saves(),1);assert.equal(f.callbacks(),1);});
