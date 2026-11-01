// Ensaio independente, somente dados sintéticos. Ex.: node este-arquivo.mjs /caminho/pglite/dist/index.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {executarRecebimentos} from '../supabase/functions/dmd-api/recebimentos-api.mjs';
const runtime=process.argv[2];
if(!runtime)throw Error('Informe o caminho do runtime local PGlite para executar este ensaio SQL.');
const {PGlite}=await import(pathToFileURL(runtime).href),db=new PGlite();
const migration=fs.readFileSync(new URL('../supabase/migrations/202611011900_caixa_recebimentos.sql',import.meta.url),'utf8');
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.dmd_kv(store text NOT NULL,key text NOT NULL,valor jsonb,atualizado_em timestamptz DEFAULT now(),PRIMARY KEY(store,key));');
await db.exec(migration);
const unidade={id:'qa-sql',unidade:'QA-SQL',status:'Vendido',clienteId:'qa-cliente',atualizadoEm:'revisao-1'};
const cliente={id:'qa-cliente',cliente:'Comprador sintético'};
const condicoes={unidadeId:unidade.id,clienteId:cliente.id,unidadeRevisao:unidade.atualizadoEm,revisao:1,total:120000,entrada:20000,data:'2026-10-01',permutas:[{descricao:'Bem de teste',valor:10000}],parcelas:[{descricao:'Mensais de teste',valor:30000,quantidade:3,intervalo:1,primeiro:'2026-10-31'}]};
const put=(store,key,valor)=>db.query('INSERT INTO dmd_kv(store,key,valor) VALUES($1,$2,$3::jsonb) ON CONFLICT(store,key) DO UPDATE SET valor=excluded.valor',[store,key,JSON.stringify(valor)]);
const read=async(store,key)=>(await db.query('SELECT valor FROM dmd_kv WHERE store=$1 AND key=$2',[store,key])).rows[0]?.valor||null;
await put('unidades',unidade.id,unidade);await put('leads',cliente.id,cliente);await put('vendas_condicoes',unidade.id,condicoes);
let beforeCommit=null,lastParams=null;
const raw=async p=>(await db.query('SELECT public.dmd_caixa_recebimento_salvar($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) AS resultado',[p.p_id,...['p_unidade_antes','p_cliente_antes','p_condicoes_antes','p_antes','p_depois'].map(k=>p[k]===null?null:JSON.stringify(p[k]))])).rows[0].resultado;
const sb={rpc:async(name,p)=>{assert.equal(name,'dmd_caixa_recebimento_salvar');lastParams=structuredClone(p);if(beforeCommit)await beforeCommit(p);try{return {data:await raw(p)};}catch(error){return {error};}}};
const getStore=store=>({get:key=>read(store,key),listJSON:async()=>(await db.query('SELECT key,valor FROM dmd_kv WHERE store=$1',[store])).rows});
const usr={usuario:'domo',_ehMaster:true},now=new Date('2026-11-01T12:00:00Z');
const run=b=>executarRecebimentos(b,usr,{getStore,sb,now});
const D=globalThis.DiamondCaixaDomain,plano=D.cronograma(condicoes,unidade);
const request={operacao:'confirmar',unidadeId:unidade.id,parcelaId:plano.parcelas[1].id,cronogramaChave:plano.chave,revisao:0,operacaoId:'qa-sql-operacao-00000001',valor:15000,data:'2026-10-31'};
try{
 const r=await run(request);assert.equal(r.status,200,r.data.erro);assert.equal(r.data.registro.eventos.length,1);
 const primeiro=r.data.registro;
 assert.deepEqual(await read('unidades',unidade.id),unidade);assert.deepEqual(await read('vendas_condicoes',unidade.id),condicoes);assert.deepEqual(await read('leads',cliente.id),cliente);
 const same=await raw(lastParams);assert.equal(same.repetida,true);assert.deepEqual(same.registro,primeiro);
 const outroPayload=structuredClone(lastParams);outroPayload.p_depois.eventos[0].solicitacao='outra solicitação';await assert.rejects(raw(outroPayload),/OPERACAO_CONFLITO/);

 for(const target of ['unidade','cliente','condicoes','ledger']){
  beforeCommit=async p=>{
   if(target==='unidade')await put('unidades',unidade.id,{...unidade,status:'Disponível'});
   if(target==='cliente')await put('leads',cliente.id,{...cliente,cliente:'Atualização concorrente'});
   if(target==='condicoes')await put('vendas_condicoes',unidade.id,{...condicoes,revisao:2});
   if(target==='ledger'){const concorrente=structuredClone(p.p_depois);concorrente.eventos.at(-1).operacaoId='qa-concorrente-0000001';await put('vendas_recebimentos',unidade.id,concorrente);}
  };
  const failed=await run({...request,revisao:1,valor:15000,operacaoId:'qa-sql-segunda-00000001'});assert.equal(failed.status,409,target);
  if(target!=='ledger')assert.deepEqual(await read('vendas_recebimentos',unidade.id),primeiro);
  await put('unidades',unidade.id,unidade);await put('leads',cliente.id,cliente);await put('vendas_condicoes',unidade.id,condicoes);await put('vendas_recebimentos',unidade.id,primeiro);
 }
 beforeCommit=null;
 const segunda=await run({...request,revisao:1,operacaoId:'qa-sql-segunda-00000001'});assert.equal(segunda.status,200,segunda.data.erro);
 const paramsSegunda=structuredClone(lastParams),ledger=segunda.data.registro;
 const alterarAnterior=structuredClone(paramsSegunda);alterarAnterior.p_depois.eventos.at(-1).operacaoId='qa-forjado-0000000001';alterarAnterior.p_depois.eventos[0].data='2026-10-30';alterarAnterior.p_antes=ledger;alterarAnterior.p_depois.revisao=3;await assert.rejects(raw(alterarAnterior),/RECEBIMENTO_CONFLITO/);
 assert.deepEqual(await read('vendas_recebimentos',unidade.id),ledger);
 await db.query('DELETE FROM dmd_kv WHERE store IN ($1,$2,$3)',['unidades','leads','vendas_condicoes']);
 const reversao=await run({operacao:'estornar',unidadeId:unidade.id,eventoId:primeiro.eventos[0].id,revisao:2,operacaoId:'qa-sql-estorno-00000001',motivo:'Ajuste sintético'});assert.equal(reversao.status,200,reversao.data.erro);
 assert.equal(reversao.data.registro.eventos.length,3);assert.deepEqual(reversao.data.registro.eventos.slice(0,2),ledger.eventos);
 assert.equal(D.eventosAtivos(reversao.data.registro).reduce((s,e)=>s+e.valor,0),15000);
 const retry=await raw(lastParams);assert.equal(retry.repetida,true);assert.equal(retry.registro.eventos.length,3);

 const fn='public.dmd_caixa_recebimento_salvar(text,jsonb,jsonb,jsonb,jsonb,jsonb)';
 for(const role of ['anon','authenticated'])assert.equal((await db.query('SELECT has_function_privilege($1,$2,$3) AS permitido',[role,fn,'EXECUTE'])).rows[0].permitido,false);
 assert.equal((await db.query('SELECT has_function_privilege($1,$2,$3) AS permitido',['service_role',fn,'EXECUTE'])).rows[0].permitido,true);
 console.log('PASS SQL: migração compilada; recebimento e estorno persistidos; unidade/cliente/condições preservados; idempotência e 5 conflitos verificados; histórico imutável; estorno após exclusão; anon/authenticated bloqueados.');
}finally{await db.close();}
