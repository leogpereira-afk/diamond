import test from 'node:test';
import assert from 'node:assert/strict';
import {backend,store} from './helpers.mjs';
const request=(over={})=>({operacao:'salvar',id:'lead-novo',unidadeId:'u-2',clienteAtualizadoEm:null,unidadeAtualizadaEm:null,dados:{cliente:'Cliente Teste',clienteTel:'11987654321',cadastro:{email:'teste@example.test',documento:'TESTE-001',tipoPessoa:'pj',endereco:'Rua fictícia 10',cidade:'Teste',uf:'MG',observacoes:'Observação de teste'}},...over});
test('cadastro por unidade cria vínculo explícito, preserva situação e preço e não declara fechamento CRM',async()=>{
 const b=backend();const antes=structuredClone(b.table('unidades').get('u-2'));
 const r=await b.request('clienteCadastro',request());assert.equal(r.status,200);assert.equal(r.ok,true);
 assert.equal(r.unidade.clienteId,'lead-novo');assert.equal(r.unidade.compradorNome,'Cliente Teste');assert.equal(r.unidade.status,antes.status);assert.equal(r.unidade.precoBase,antes.precoBase);
 assert.equal(r.lead.estagio,'novo');assert.equal(r.lead.cadastro.uf,'MG');assert.equal(b.table('clientes_historico').size,1);
});
test('incluir cliente em unidade disponível não reserva nem vende',async()=>{
 const b=backend();const r=await b.request('clienteCadastro',request({unidadeId:'u-1'}));
 assert.equal(r.unidade.status,'Disponível');assert.equal(r.unidade.compradorNome,undefined);assert.equal(r.unidade.clienteVinculadoNome,'Cliente Teste');assert.equal(b.table('reservas').size,0);
});
test('editar cadastro existente mantém dono, negócio, anotações CRM e propostas originais',async()=>{
 const b=backend();const lead={id:'lead-existente',cliente:'Anterior',empresaUsuario:'outra',empresaNome:'Imobiliária',corretorNome:'Corretor original',estagio:'negociando',unidade:'901',obs:'Anotação anterior',atualizadoEm:'2026-09-01T00:00:00Z'};
 b.table('leads').set(lead.id,lead);b.table('propostas').set('p-original',{cliente:'Anterior',leadId:lead.id});
 const r=await b.request('clienteCadastro',request({id:lead.id,clienteAtualizadoEm:lead.atualizadoEm}));
 assert.equal(r.status,200);assert.equal(r.lead.empresaUsuario,'outra');assert.equal(r.lead.corretorNome,'Corretor original');assert.equal(r.lead.estagio,'negociando');assert.equal(r.lead.obs,'Anotação anterior');assert.equal(r.lead.unidade,'901');assert.equal(b.table('leads').size,1);assert.equal(b.table('propostas').get('p-original').cliente,'Anterior');
});
test('edição de contato da reserva não altera prazo nem pedidos',async()=>{
 const b=backend();b.table('unidades').set('u-2',{id:'u-2',unidade:'2',status:'Reservado',reserva:{cliente:'Anterior',prazo:'2027-01-01T00:00:00Z',corretor:'Original'}});
 const r=await b.request('clienteCadastro',request());assert.equal(r.unidade.reserva.cliente,'Cliente Teste');assert.equal(r.unidade.reserva.prazo,'2027-01-01T00:00:00Z');assert.equal(r.unidade.reserva.corretor,'Original');assert.equal(r.unidade.status,'Reservado');
});
test('conflito de cliente ou unidade não grava parcialmente',async()=>{
 for(const tipo of ['cliente','unidade']){const b=backend();if(tipo==='cliente')b.table('leads').set('lead-novo',{id:'lead-novo',cliente:'Conservar',atualizadoEm:'2026-10-01'});else b.table('unidades').get('u-2').atualizadoEm='2026-10-01';
 const r=await b.request('clienteCadastro',request());assert.equal(r.status,409);assert.equal(b.table('clientes_historico').size,0);assert.equal(b.table('unidades').get('u-2').clienteId,undefined);}
});
test('documento duplicado bloqueia e homônimo exige confirmação explícita',async()=>{
 const b=backend();b.table('leads').set('lead-outro',{id:'lead-outro',cliente:'Outro',cadastro:{documento:'teste001'}});
 assert.equal((await b.request('clienteCadastro',request())).status,409);
 b.table('leads').set('lead-outro',{id:'lead-outro',cliente:'Cliente Teste'});
 assert.equal((await b.request('clienteCadastro',request())).status,409);
 assert.equal((await b.request('clienteCadastro',request({confirmarPessoaDiferente:true}))).status,200);
});
test('dados inválidos e usuários sem gestão não gravam cadastro',async()=>{
 const b=backend();b.table('cfg').get('usuarios').push({usuario:'corretor',nome:'Corretor',papel:'corretor',hash:'fake'});
 for(const user of ['cliente','corretor'])for(const operacao of ['carregar','salvar'])assert.equal((await b.request('clienteCadastro',request({operacao}),user)).status,403);
 assert.equal((await b.request('clienteCadastro',request({dados:{cliente:'',cadastro:{}}}))).status,400);
 assert.equal((await b.request('clienteCadastro',request({dados:{cliente:'Teste',cadastro:{email:'email errado'}}}))).status,400);
 assert.equal(b.table('leads').size,0);
});
test('espelho externo não recebe o vínculo nem dados do cadastro',async()=>{
 const b=backend();await b.request('clienteCadastro',request());
 const r=await b.request('list',{},'cliente'),u=r.unidades.find(u=>u.id==='u-2');
 for(const k of ['clienteId','clienteVinculadoNome','compradorNome','cadastro'])assert.equal(u[k],undefined);
});
test('CRM anterior preserva dados cadastrais e edição por unidade não fica numa fila offline',async()=>{
 const b=backend();const r=await b.request('clienteCadastro',request());
 const crm=await b.request('upsertLead',{lead:{...r.lead,obs:'Novo contato'},comoCorretor:'Teste'});
 assert.equal(crm.lead.cadastro.email,'teste@example.test');
 const {s}=store(async()=>({ok:false,status:500,json:async()=>({erro:'Falha simulada'})}));
 await assert.rejects(s.salvarCadastroCliente(request()),/Falha simulada/);assert.equal(s.getLeads().length,0);assert.equal(s.filaGet().length,0);
});
test('cliente vinculado não pode ser excluído deixando a unidade órfã',async()=>{
 const b=backend();await b.request('clienteCadastro',request());assert.equal((await b.request('delLead',{id:'lead-novo'})).status,409);assert.equal(b.table('leads').size,1);
});
