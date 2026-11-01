// Ensaio real de transações paralelas. Runtime embedded-postgres informado na CLI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
import '../supabase/functions/dmd-api/caixa-domain.js';
if(!process.argv[2])throw Error('Informe o caminho local do módulo embedded-postgres/dist/index.js.');
const {default:EmbeddedPostgres}=await import(pathToFileURL(process.argv[2]).href);
const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const databaseDir=await fs.mkdtemp(path.join(os.tmpdir(),'diamond-caixa-concorrencia-'));
const pg=new EmbeddedPostgres({databaseDir,port,user:'postgres',password:crypto.randomUUID(),authMethod:'scram-sha-256',persistent:false,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
const clients=[];
try{
 await pg.initialise();await pg.start();
 for(let i=0;i<3;i++){const c=pg.getPgClient();await c.connect();await c.query("SET statement_timeout='10s'");clients.push(c);}
 const [admin,a,b]=clients;
 await admin.query('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE dmd_kv(store text NOT NULL,key text NOT NULL,valor jsonb,atualizado_em timestamptz DEFAULT now(),PRIMARY KEY(store,key));');
 await admin.query(await fs.readFile(new URL('../supabase/migrations/202611011900_caixa_recebimentos.sql',import.meta.url),'utf8'));
 const u={id:'qa-concorrencia',unidade:'QA',clienteId:'qa-cliente',status:'Vendido',atualizadoEm:'rev-1'},c={id:'qa-cliente',cliente:'Comprador sintético'};
 const venda={unidadeId:u.id,clienteId:c.id,unidadeRevisao:u.atualizadoEm,total:10000,entrada:0,data:'2026-10-01',permutas:[],parcelas:[{descricao:'Parcela teste',valor:10000,quantidade:1,intervalo:1,primeiro:'2026-10-31'}]};
 for(const [store,key,value]of [['unidades',u.id,u],['leads',c.id,c],['vendas_condicoes',u.id,venda]])await admin.query('INSERT INTO dmd_kv(store,key,valor)VALUES($1,$2,$3)',[store,key,value]);
 const plano=globalThis.DiamondCaixaDomain.cronograma(venda,u);
 function registro(op){return {unidadeId:u.id,revisao:1,eventos:[{id:crypto.randomUUID(),operacaoId:op,tipo:'receber',parcelaId:plano.parcelas[0].id,cronogramaChave:plano.chave,valor:10000,data:'2026-10-31',por:'domo',em:'2026-11-01T12:00:00Z',solicitacao:'payload-sintetico',fonte:{clienteId:c.id,unidade:u.unidade,cliente:c.cliente,descricao:'Parcela teste',vencimento:'2026-10-31',valorPrevisto:10000}}],atualizadoEm:'2026-11-01T12:00:00Z',atualizadoPor:'domo'};}
 const call=(client,r)=>client.query('SELECT public.dmd_caixa_recebimento_salvar($1,$2,$3,$4,$5,$6) AS resultado',[u.id,u,c,venda,null,r]);
 const read=async()=>(await admin.query("SELECT valor FROM dmd_kv WHERE store='vendas_recebimentos' AND key=$1",[u.id])).rows[0]?.valor;
 // Duas abas, mesma revisão, operações diferentes: só uma baixa entra no caixa.
 const diferentes=await Promise.allSettled([call(a,registro('qa-concorrencia-00001')),call(b,registro('qa-concorrencia-00002'))]);
 assert.equal(diferentes.filter(r=>r.status==='fulfilled').length,1);
 assert.match(diferentes.find(r=>r.status==='rejected').reason.message,/RECEBIMENTO_CONFLITO/);
 assert.equal((await read()).eventos.length,1);
 await admin.query("DELETE FROM dmd_kv WHERE store='vendas_recebimentos'");
 // Reenvio simultâneo da mesma solicitação: a segunda resposta é idempotente.
 const mesmo=registro('qa-concorrencia-mesmo01');
 const repetidos=await Promise.all([call(a,mesmo),call(b,mesmo)]);
 assert.deepEqual(repetidos.map(r=>r.rows[0].resultado.repetida).sort(),[false,true]);assert.equal((await read()).eventos.length,1);
 // Repetição com o mesmo ID e payload diferente não pode sobrescrever a primeira.
 const mudado=structuredClone(mesmo);mudado.eventos[0].solicitacao='outro-payload';await assert.rejects(call(a,mudado),/OPERACAO_CONFLITO/);
 assert.deepEqual(await read(),mesmo);
 console.log('PASS PostgreSQL: duas confirmações paralelas geram uma baixa; retry simultâneo é idempotente; payload divergente é recusado; fontes e histórico preservados.');
}finally{
 await Promise.allSettled(clients.map(c=>c.end()));await pg.stop();
}
