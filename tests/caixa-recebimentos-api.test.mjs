import test from 'node:test';
import assert from 'node:assert/strict';
import {backend,copy,source} from './helpers.mjs';
import {executarRecebimentos} from '../supabase/functions/dmd-api/recebimentos-api.mjs';

const D=globalThis.DiamondCaixaDomain;
const unidade={id:'qa-unidade',unidade:'QA01',status:'Vendido',clienteId:'qa-cliente',atualizadoEm:'revisao-unidade'};
const cliente={id:'qa-cliente',cliente:'Comprador de teste'};
const condicao={unidadeId:unidade.id,clienteId:cliente.id,unidadeRevisao:unidade.atualizadoEm,revisao:1,total:120000,entrada:20000,data:'2026-10-01',permutas:[{descricao:'Bem sintético',valor:10000}],parcelas:[{descricao:'Mensais',valor:30000,quantidade:3,intervalo:1,primeiro:'2026-10-31'}]};
const plano=D.cronograma(condicao,unidade);
const confirmar={operacao:'confirmar',unidadeId:unidade.id,parcelaId:plano.parcelas[1].id,cronogramaChave:plano.chave,revisao:0,operacaoId:'qa-confirmacao-00000001',data:'2026-10-31',valor:30000,observacao:'Conferência sintética'};
function setup(options={}){const b=backend(options);b.table('unidades').set(unidade.id,copy(unidade));b.table('leads').set(cliente.id,copy(cliente));b.table('vendas_condicoes').set(unidade.id,copy(condicao));return b;}
const run=(b,req=confirmar,user='domo')=>b.request('caixaRecebimentos',req,user);
const estorno=(r,changes={})=>({operacao:'estornar',unidadeId:unidade.id,eventoId:r.registro.eventos[0].id,revisao:r.registro.revisao,operacaoId:'qa-estorno-000000001',motivo:'Confirmação de teste a desfazer',...changes});

test('caixa exige administrador ou master Domo, nunca corretor, cliente ou equipe Domo',async()=>{
 const b=setup();
 for(const user of [null,'cliente','inexistente'])assert.equal((await run(b,{operacao:'listar'},user)).status,403);
 const usuarios=b.table('cfg').get('usuarios');usuarios.find(u=>u.usuario==='domo').hashCorretores='fake-team';
 usuarios.push({usuario:'corretor-comum',papel:'corretor',ativo:true,hash:'fake'});
 assert.equal((await run(b,{operacao:'listar'},'corretor-comum')).status,403);
 assert.equal((await run(b,{operacao:'listar',auth:{usuario:'domo',senhaHash:'fake-team'}},null)).status,403);
 b.table('cfg').get('cfg').corretorGeralHash='fake-universal';
 assert.equal((await run(b,{operacao:'listar',auth:{usuario:'domo',senhaHash:'fake-universal'}},null)).status,403);
 assert.equal((await run(b,{operacao:'listar'},'admin')).status,200);
 assert.equal((await run(b,{operacao:'listar'},'domo')).status,200);
 assert.equal(b.table('vendas_recebimentos').size,0);
});
test('confirma parcela em centavos e preserva integralmente venda, cliente e unidade',async()=>{
 const b=setup(),r=await run(b);assert.equal(r.status,200,r.erro);assert.equal(r.repetida,false);
 assert.equal(r.registro.revisao,1);const e=r.registro.eventos[0];
 assert.equal(e.valor,30000);assert.equal(e.data,'2026-10-31');assert.equal(e.tipo,'receber');assert.equal(e.por,'domo');
 assert.equal(e.fonte.cliente,cliente.cliente);assert.equal(e.fonte.valorPrevisto,30000);assert.equal(e.fonte.vencimento,'2026-10-31');
 assert.deepEqual(b.table('vendas_condicoes').get(unidade.id),condicao);assert.deepEqual(b.table('unidades').get(unidade.id),unidade);assert.deepEqual(b.table('leads').get(cliente.id),cliente);
 const leitura=await run(b,{operacao:'listar'});assert.deepEqual(leitura.recebimentos,[r.registro]);
});
test('entrada sem vencimento aceita recebimento com data real, sem inferir permuta como caixa',async()=>{
 const b=setup(),r=await run(b,{...confirmar,parcelaId:'entrada',valor:20000,data:'2026-10-02'});assert.equal(r.status,200,r.erro);assert.equal(r.registro.eventos[0].fonte.vencimento,null);
 const inexistente=await run(setup(),{...confirmar,parcelaId:'permuta:0',valor:10000});assert.equal(inexistente.status,409);
});
test('recebimentos parciais fecham saldo e não admitem excesso ou dupla baixa',async()=>{
 const b=setup(),a=await run(b,{...confirmar,valor:10001});assert.equal(a.status,200,a.erro);
 const x=await run(b,{...confirmar,revisao:1,operacaoId:'qa-parcial-000000002',valor:20000});assert.equal(x.status,409);
 const z=await run(b,{...confirmar,revisao:1,operacaoId:'qa-parcial-000000003',valor:19999});assert.equal(z.status,200,z.erro);
 assert.equal(D.eventosAtivos(z.registro).reduce((s,e)=>s+e.valor,0),30000);
 assert.equal((await run(b,{...confirmar,revisao:2,operacaoId:'qa-parcial-000000004',valor:1})).status,409);assert.equal(b.table('vendas_recebimentos').get(unidade.id).eventos.length,2);
});
test('retry após perda de resposta é idempotente e payload diferente não reutiliza a operação',async()=>{
 const b=setup({loseRecebimentoResponse:true}),r=await run(b);assert.equal(r.status,503);assert.equal(b.table('vendas_recebimentos').get(unidade.id).eventos.length,1);
 const retry=await run(b);assert.equal(retry.status,200,retry.erro);assert.equal(retry.repetida,true);assert.equal(retry.registro.eventos.length,1);
 assert.equal((await run(b,{...confirmar,valor:1})).status,409);
});
test('repetição que atravessa o commit é reconhecida dentro da transação',async()=>{
 const b=setup({beforeRecebimentoCommit:({table,p})=>table('vendas_recebimentos').set(p.p_id,copy(p.p_depois))});
 const r=await run(b);assert.equal(r.status,200,r.erro);assert.equal(r.repetida,true);assert.equal(r.registro.eventos.length,1);
});
test('parcela e cronograma não podem ser forjados ou confirmados com revisão antiga',async()=>{
 for(const change of [{cronogramaChave:'antiga'},{parcelaId:'inexistente'},{revisao:1}]){const b=setup();assert.equal((await run(b,{...confirmar,...change})).status,409);assert.equal(b.table('vendas_recebimentos').size,0);}
 for(const valor of [0,-1,0.1,'30000',Number.MAX_SAFE_INTEGER])assert.equal((await run(setup(),{...confirmar,valor})).status,400);
 for(const data of ['2026-09-30','2199-01-01','2026-02-30','31/10/2026'])assert.equal((await run(setup(),{...confirmar,data})).status,400);
});
test('contrato inválido, reabertura, comprador ausente ou inativo impedem nova confirmação',async()=>{
 const casos=[b=>b.table('unidades').get(unidade.id).status='Disponível',b=>b.table('vendas_condicoes').delete(unidade.id),b=>b.table('leads').delete(cliente.id),b=>b.table('leads').get(cliente.id).ativo=false,b=>b.table('unidades').get(unidade.id).clienteId='outro'];
 for(const mudar of casos){const b=setup();mudar(b);assert.equal((await run(b)).status,409);assert.equal(b.table('vendas_recebimentos').size,0);}
});
test('CAS recusa alteração concorrente de unidade, cliente, condições ou ledger',async()=>{
 for(const tipo of ['unidade','cliente','condicoes','ledger']){
  const b=setup({beforeRecebimentoCommit:({table,p})=>{
   if(tipo==='unidade')table('unidades').get(unidade.id).status='Disponível';
   if(tipo==='cliente')table('leads').get(cliente.id).cliente='Outro nome';
   if(tipo==='condicoes')table('vendas_condicoes').get(unidade.id).parcelas[0].valor++;
   if(tipo==='ledger'){const concorrente=copy(p.p_depois);concorrente.eventos[0].operacaoId='qa-concorrente-00000001';table('vendas_recebimentos').set(unidade.id,concorrente);}
  }});
  assert.equal((await run(b)).status,409,tipo);assert.equal(b.table('vendas_recebimentos').size,tipo==='ledger'?1:0);
 }
});
test('falha de gravação não produz confirmação nem altera condições',async()=>{
 const b=setup({failRecebimentoCommit:true}),r=await run(b);assert.equal(r.status,503);assert.equal(b.table('vendas_recebimentos').size,0);assert.deepEqual(b.table('vendas_condicoes').get(unidade.id),condicao);
});
test('estorno preserva evento original; revisão e operação repetida não duplicam',async()=>{
 const b=setup(),r=await run(b),request=estorno(r),s=await run(b,request);assert.equal(s.status,200,s.erro);
 assert.equal(s.registro.eventos.length,2);assert.deepEqual(s.registro.eventos[0],r.registro.eventos[0]);assert.equal(s.registro.eventos[1].eventoId,r.registro.eventos[0].id);assert.equal(D.eventosAtivos(s.registro).length,0);
 const retry=await run(b,request);assert.equal(retry.status,200);assert.equal(retry.repetida,true);
 assert.equal((await run(b,{...request,revisao:2,operacaoId:'qa-outro-estorno-000001'})).status,409);
 const novamente=await run(b,{...confirmar,revisao:2,operacaoId:'qa-reconfirmar-00000001'});assert.equal(novamente.status,200,novamente.erro);assert.equal(novamente.registro.eventos.length,3);
 const anterior=await run(b,confirmar);assert.equal(anterior.status,200);assert.equal(anterior.repetida,true);assert.equal(anterior.registro.eventos.length,3);
});
test('mudança financeira bloqueia novas baixas até conferência e permite estornar a antiga',async()=>{
 const b=setup(),r=await run(b),c=b.table('vendas_condicoes').get(unidade.id);c.parcelas[0].primeiro='2026-11-01';
 const novo=D.cronograma(c,unidade);assert.notEqual(novo.chave,plano.chave);
 const req={...confirmar,parcelaId:novo.parcelas[1].id,cronogramaChave:novo.chave,revisao:1,operacaoId:'qa-novo-cronograma-0001'};
 assert.equal((await run(b,req)).status,409);const reversao=await run(b,estorno(r));assert.equal(reversao.status,200,reversao.erro);
 assert.equal((await run(b,{...req,revisao:2})).status,200);
});
test('estorno continua possível depois de reabrir ou excluir a unidade',async()=>{
 for(const remover of [false,true]){const b=setup(),r=await run(b);if(remover)b.table('unidades').delete(unidade.id);else b.table('unidades').get(unidade.id).status='Disponível';b.table('vendas_condicoes').delete(unidade.id);b.table('leads').delete(cliente.id);const s=await run(b,estorno(r));assert.equal(s.status,200,s.erro);assert.equal(s.registro.eventos.length,2);}
});
test('correção de observação não muda cronograma nem invalida o recebimento',async()=>{
 const b=setup(),r=await run(b,{...confirmar,valor:10000});b.table('vendas_condicoes').get(unidade.id).observacoes='Nota atualizada';
 const s=await run(b,{...confirmar,valor:20000,revisao:1,operacaoId:'qa-nota-000000000002'});assert.equal(r.status,200);assert.equal(s.status,200,s.erro);
});
test('histórico malformado é preservado e bloqueia gravação',async()=>{
 const b=setup();b.table('vendas_recebimentos').set(unidade.id,{unidadeId:unidade.id,revisao:1,eventos:[]});const antes=copy(b.table('vendas_recebimentos').get(unidade.id));
 assert.equal((await run(b)).status,409);assert.deepEqual(b.table('vendas_recebimentos').get(unidade.id),antes);
});
test('trilha incompleta não aceita alteração e limite mantém todos os eventos existentes',async()=>{
 const b=setup(),r=await run(b,{...confirmar,valor:1}),original=copy(r.registro);
 const semFonte=copy(original);delete semFonte.eventos[0].fonte;b.table('vendas_recebimentos').set(unidade.id,semFonte);
 assert.equal((await run(b,{...confirmar,revisao:1,operacaoId:'qa-fonte-000000000001'})).status,409);
 assert.deepEqual(b.table('vendas_recebimentos').get(unidade.id),semFonte);
 const cheio={...original,revisao:10000,eventos:Array.from({length:10000},(_,i)=>({...copy(original.eventos[0]),id:'qa-evento-'+i,operacaoId:'qa-limite-operacao-'+i}))};
 assert.equal(D.validarLedger(cheio),true);b.table('vendas_recebimentos').set(unidade.id,cheio);
 const limite=await run(b,{...confirmar,valor:1,revisao:10000,operacaoId:'qa-limite-nova-00001'});assert.equal(limite.status,409);assert.match(limite.erro,/limite/);assert.deepEqual(b.table('vendas_recebimentos').get(unidade.id),cheio);
});
test('backup inclui ledger e a RPC é fechada aos papéis públicos',()=>{
 assert.match(source('supabase/functions/dmd-api/api-core.mjs'),/const ORDEM = \[[^\]]*'vendas_recebimentos'/);
 const sql=source('supabase/migrations/20261101230000_caixa_recebimentos.sql');assert.match(sql,/revoke all on function[^;]+from public,anon,authenticated/);assert.match(sql,/grant execute on function[^;]+to service_role/);
});
