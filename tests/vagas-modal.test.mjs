import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source,copy} from './helpers.mjs';

function state(){
 const vagas=Array.from({length:82},(_,i)=>({numero:i+1,codigo:`V${String(i+1).padStart(2,'0')}`,piso:i<25?0:i<51?1:2,apartamento:i===18?'Apto 1007':'',cliente:i===18?'Cliente original':'',situacao:i===18?'vendida':'disponivel',contrato:'',reserva:'',expiracao:'',observacoes:'',alertas:[],avisos:[],origem:{gestao:{},vinculos:[]},assinatura:'original'}));
 return {vagas,unidades:[{apartamento:'Apto 1007'},{apartamento:'Apto 401'}],historico:[],fonte:{abaUnica:true},ajustes:{}};
}
function fixture(){
 let server={revisao:10,estado:state()},writes=0,firstSave=null,modal,session='test';
 const form={values:{vaga:'V19',situacao:'vendida',apartamento:'Apto 1007',cliente:'Cliente corrigido',contrato:'Assinaturas',reserva:'',expiracao:'',observacoes:'Texto digitado',motivo:'Conferido com cadastro'}};
 const error={textContent:'',scrollIntoView(){}},button={disabled:false,textContent:'Salvar alterações'},confirm={hidden:true,innerHTML:'',querySelector:()=>confirmButton},confirmButton={onclick:null};
 const fundo={isConnected:true,classList:{add(){}},querySelector:s=>s==='form'?form:s==='#vgErroForm'?error:s==='footer .primario'?button:s==='#vgConferencia'?confirm:null,remove(){this.isConnected=false;}};
 const ctx=vm.createContext({console,Date,URLSearchParams,structuredClone,setInterval(){},setTimeout(){},document:{addEventListener(){},getElementById(){return null}},window:{},location:{hash:'#/admin/vagas'},sessionStorage:{removeItem(){}},FormData:class{constructor(f){return Object.entries(f.values)}},STORE:{getUser:()=>({senhaHash:session}),isAdmin:()=>true,podeVerPainel:()=>true,api:async(action,p)=>{assert.equal(action,'vagas');if(p.operacao==='carregar')return copy(server);if(p.operacao==='salvar'){if(firstSave){const fn=firstSave;firstSave=null;fn(server);}if(p.revisao!==server.revisao){const e=Error('Outra pessoa atualizou o espelho. Atualize e confira antes de salvar.');e.status=409;throw e;}writes++;server.estado.ajustes[p.codigo]={...copy(p.ajuste),assinatura:server.estado.vagas.find(v=>v.codigo===p.codigo).assinatura};return copy({...server,revisao:++server.revisao});}throw Error('Operação inesperada');}}});
 vm.runInContext(source('vagas-domain.js'),ctx);
 const inject=`\nabrirModal=opts=>{globalThis.capture(opts);return globalThis.fakeModal;};desenhar=()=>{};toast=()=>{};globalThis.ui={open:abrir,base:b=>base=b,filter:(s,vs)=>{filtro=s;return selecionadas(vs)},label:txtStatus};\n`;
 ctx.capture=opts=>modal=opts;ctx.fakeModal=fundo;
 const code=source('vagas.js');vm.runInContext(code.slice(0,code.lastIndexOf('})();'))+inject+'})();',ctx);
 ctx.ui.base(copy(server));ctx.ui.open('V19');
 return {ctx,form,error,button,confirm,confirmButton,server:()=>server,change:fn=>{fn(server);server.revisao++;},race:fn=>firstSave=s=>{fn(s);s.revisao++;},save:()=>modal.acoes.at(-1).aoClicar(fundo),writes:()=>writes,session:s=>session=s};
}

test('salvar modal mantém edição e usa revisão atual quando apenas outra vaga foi atualizada',async()=>{
 const f=fixture();f.change(s=>s.estado.vagas[0].observacoes='Outra vaga atualizada');await f.save();
 assert.equal(f.writes(),1,'Uma revisão geral nova não deve impedir salvar uma vaga inalterada');
 assert.equal(f.server().estado.ajustes.V19.cliente,'Cliente corrigido');assert.equal(f.server().estado.vagas[0].observacoes,'Outra vaga atualizada');
});

test('mudança real na vaga exige conferência explícita e preserva os campos digitados',async()=>{
 const f=fixture();f.change(s=>s.estado.vagas[18].cliente='Outra pessoa');await f.save();
 assert.equal(f.writes(),0);assert.match(f.error.textContent,/mudou|alterad/i);assert.match(f.confirm.innerHTML,/Outra pessoa/);assert.equal(f.form.values.cliente,'Cliente corrigido');assert.equal(typeof f.confirmButton.onclick,'function');
 f.confirmButton.onclick();await f.save();assert.equal(f.writes(),1);assert.equal(f.server().estado.ajustes.V19.cliente,'Cliente corrigido');
});

test('conflito entre consulta e gravação relê uma vez sem abandonar CAS',async()=>{
 const f=fixture();f.race(s=>s.estado.vagas[0].observacoes='Sincronizado');await f.save();assert.equal(f.writes(),1);assert.equal(f.server().estado.vagas[0].observacoes,'Sincronizado');
});

test('uma edição concorrente da vaga durante a gravação nunca é sobrescrita automaticamente',async()=>{
 const f=fixture();f.race(s=>s.estado.vagas[18].cliente='Comprador novo');await f.save();assert.equal(f.writes(),0);assert.match(f.confirm.innerHTML,/Comprador novo/);assert.equal(f.form.values.observacoes,'Texto digitado');
});

test('vínculo novo do apartamento em outra vaga é um conflito relevante',async()=>{
 const f=fixture();f.change(s=>{s.estado.vagas[0].apartamento='Apto 1007';s.estado.vagas[0].situacao='reservada';});await f.save();assert.equal(f.writes(),0);assert.match(f.confirm.innerHTML,/V01/);
});

test('vagas vinculadas não entram no filtro de vagas realmente disponíveis',()=>{
 const f=fixture(),vs=f.ctx.DomoVagas.efetivas(f.server().estado);vs[0].apartamento='Apto 401';
 assert.equal(f.ctx.ui.filter('disponivel',vs).some(v=>v.codigo==='V01'),false);assert.match(f.ctx.ui.label(vs[0]),/Vinculada.*401/);
});

test('metadados da sincronização e contador calculado não criam conflito de edição',async()=>{
 const f=fixture();f.change(s=>{s.estado.sync={ultimaConsulta:'2026-10-05T17:00:00Z',ultimaConclusao:'2026-10-05T17:00:00Z'};s.estado.fonte.lidoEm='2026-10-05T17:00:00Z';s.estado.vagas[18].origem.gestao['contador de dias']='80';s.estado.vagas[18].origem.gestao['']='';});await f.save();assert.equal(f.writes(),1);
});

test('destino ocupado após abrir o modal bloqueia a troca sem perder o destino escolhido',async()=>{
 const f=fixture();f.form.values.vaga='V01';f.change(s=>{s.estado.vagas[0].apartamento='Apto 401';s.estado.vagas[0].situacao='vendida';s.estado.vagas[0].cliente='Novo ocupante';});await f.save();assert.equal(f.writes(),0);assert.match(f.confirm.innerHTML,/Novo ocupante/);assert.equal(f.form.values.vaga,'V01');
});

test('alteração comercial na linha do apartamento também exige conferência',async()=>{
 const f=fixture();f.change(s=>s.estado.unidades[0]['cliente / proprietario']='Novo titular na planilha');await f.save();assert.equal(f.writes(),0);assert.match(f.confirm.innerHTML,/Novo titular na planilha/);
});

test('planilha aguardando confirmação não recebe nova escrita e formulário permanece editável',async()=>{
 const f=fixture();f.change(s=>s.estado.sync={pendente:{id:'em-confirmacao'}});await f.save();assert.equal(f.writes(),0);assert.equal(f.button.disabled,false);assert.match(f.error.textContent,/confirmando/);assert.equal(f.form.values.cliente,'Cliente corrigido');
});
