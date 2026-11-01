// PostgreSQL real e isolado: DIAMOND_PG_DEPS=/path/to/node_modules node tests/previsao-sync-postgres.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {executarPrevisaoCusto} from '../supabase/functions/dmd-api/previsao-custo-api.mjs';
const deps=process.env.DIAMOND_PG_DEPS;
if(!deps)throw Error('Set DIAMOND_PG_DEPS to isolated embedded-postgres@17.6.0-beta.15 dependencies.');
const {default:EmbeddedPostgres}=await import(pathToFileURL(path.join(deps,'embedded-postgres/dist/index.js')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'diamond-pg-previsao-'));
const db=new EmbeddedPostgres({databaseDir:directory,port:55447,user:'postgres',password:'isolated-fixture-only',persistent:false,postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[];let checks=0;
const check=label=>{checks++;console.log('PASS '+label);};
const sql='select public.dmd_previsao_custo_salvar($1,$2::uuid,$3::jsonb,$4) as result';
const signature='public.dmd_previsao_custo_salvar(bigint,uuid,jsonb,text)';
const data=()=>({...globalThis.DiamondPrevisaoSchema.defaults(),contributionsReviewed:true,contributions:[{id:'synthetic',socio:'Sócio de teste',data:'2026-01-01',valorCents:12345,observacao:''}]});
const args=(revision=0,operation=crypto.randomUUID(),dados=data(),actor='domo')=>[revision,operation,dados,actor];
const connect=async()=>{const client=db.getPgClient('postgres','127.0.0.1');await client.connect();clients.push(client);return client;};
const apiFor=client=>(body,usr={usuario:'domo'})=>executarPrevisaoCusto(body,usr,{
 getStore:store=>({get:async key=>(await client.query('select valor from public.dmd_kv where store=$1 and key=$2',[store,key])).rows[0]?.valor??null}),
 sb:{rpc:async(name,p)=>{assert.equal(name,'dmd_previsao_custo_salvar');try{return{data:(await client.query(sql,[p.p_revisao,p.p_operacao_id,p.p_dados,p.p_usuario])).rows[0].result};}catch(error){return{error};}}},
});
try{
 await db.initialise();await db.start();const c=await connect(),a=await connect(),b=await connect();
 console.log((await c.query('select version()')).rows[0].version);
 await c.query(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.dmd_kv(store text not null,key text not null,valor jsonb not null,atualizado_em timestamptz not null default now(),primary key(store,key));
 alter table public.dmd_kv enable row level security;
 grant usage on schema public to service_role,anon,authenticated;
 grant all on public.dmd_kv to service_role,anon,authenticated;
 insert into public.dmd_kv(store,key,valor) values('cfg','cfg','{"synthetic":"preserve"}'),('unidades','synthetic','{"status":"Disponível"}');`);
 const snapshot=async()=>(await c.query('select * from public.dmd_kv order by store,key')).rows;
 const before=await snapshot();
 await c.query(await fs.readFile(new URL('../supabase/migrations/20261101215154_previsao_custo_sincronizada.sql',import.meta.url),'utf8'));
 assert.deepEqual(await snapshot(),before);check('migration compiles without changing existing rows');
 assert.equal((await c.query('select prosecdef from pg_proc where oid=$1::regprocedure',[signature])).rows[0].prosecdef,false);
 for(const role of ['anon','authenticated']){
  assert.equal((await c.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).rows[0].allowed,false);
  await a.query('set role '+role);await assert.rejects(a.query(sql,args()),{code:'42501'});assert.equal((await a.query('select * from public.dmd_kv')).rows.length,0);await a.query('reset role');
 }
 assert.equal((await c.query('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') allowed',[signature])).rows[0].allowed,true);check('SECURITY INVOKER and service_role-only execute; public roles cannot read RLS records');
 await a.query('set role service_role');const initialArgs=args(),first=(await a.query(sql,initialArgs)).rows[0].result;await a.query('reset role');
 assert.equal(first.registro.revision,1);assert.equal(first.registro.updatedBy,'domo');assert.equal(new Date(first.registro.updatedAt).toISOString(),first.registro.updatedAt);assert.deepEqual(first.registro.data,data());assert.equal(first.repetida,false);check('authorized write atomically creates record and server metadata');
 const operation=(await c.query("select valor from public.dmd_kv where store='previsao_custo_operacoes'")).rows[0].valor;assert.equal(operation.operationId,initialArgs[1]);assert.match(operation.requestHash,/^[a-f0-9]{64}$/);assert.equal(operation.actor,'domo');
 const reorder=Object.fromEntries(Object.entries(initialArgs[2]).reverse());reorder.settings=Object.fromEntries(Object.entries(reorder.settings).reverse());
 const repeated=(await b.query(sql,[initialArgs[0],initialArgs[1],reorder,initialArgs[3]])).rows[0].result;assert.equal(repeated.repetida,true);assert.deepEqual(repeated.registro,first.registro);check('canonical JSON payload retry returns same revision without another operation');
 for(const changed of [[1,initialArgs[1],data(),'domo'],[0,initialArgs[1],globalThis.DiamondPrevisaoSchema.defaults(),'domo'],[0,initialArgs[1],data(),'admin']])await assert.rejects(b.query(sql,changed),/PREVISAO_OPERACAO_CONFLITO/);
 assert.equal((await c.query("select count(*)::int n from public.dmd_kv where store='previsao_custo_operacoes'")).rows[0].n,1);check('same operation cannot change actor, expected revision or payload');
 const next=(await b.query(sql,args(1,crypto.randomUUID(),globalThis.DiamondPrevisaoSchema.defaults(),'admin'))).rows[0].result;
 const oldRetry=(await a.query(sql,initialArgs)).rows[0].result;assert.equal(oldRetry.repetida,true);assert.deepEqual(oldRetry.registro,next.registro);assert.equal(next.registro.revision,2);check('old retry returns latest record and never rolls back later edits');
 const clean=async()=>c.query("delete from public.dmd_kv where store in ('previsao_custo','previsao_custo_operacoes')");
 const blocked=async pid=>{for(let i=0;i<80;i++){if((await c.query('select cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n>0)return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Expected PostgreSQL advisory lock contention');};
 await clean();await a.query('begin');await a.query(sql,args());const pending=b.query(sql,args()).then(()=>null,error=>error);await blocked(b.processID);await a.query('commit');assert.match((await pending).message,/PREVISAO_CONFLITO/);
 assert.equal((await c.query("select valor->>'revision' revision from public.dmd_kv where store='previsao_custo'")).rows[0].revision,'1');assert.equal((await c.query("select count(*)::int n from public.dmd_kv where store='previsao_custo_operacoes'")).rows[0].n,1);check('first creation serializes even while the record does not exist');
 const concurrent=await Promise.all([apiFor(a),apiFor(b)].map((api,i)=>api({operacao:'salvar',revisao:1,operacaoId:crypto.randomUUID(),dados:{...data(),contributionsReviewed:!!i}})));
 assert.deepEqual(concurrent.map(result=>result.status).sort(),[200,409]);assert.equal((await apiFor(c)({operacao:'carregar'})).data.registro.revision,2);check('two real concurrent API saves yield one HTTP 200 and one HTTP 409');
 const secondDevice=await apiFor(b)({operacao:'carregar'},{usuario:'admin',papel:'admin'});assert.equal(secondDevice.status,200);assert.equal(secondDevice.data.registro.revision,2);check('second device reads the committed shared record through the API');
 await clean();const same=args();const parallelSame=await Promise.all([a.query(sql,same),b.query(sql,same)]);assert.deepEqual(parallelSame.map(v=>v.rows[0].result.repetida).sort(),[false,true]);assert.equal((await c.query("select count(*)::int n from public.dmd_kv where store='previsao_custo_operacoes'")).rows[0].n,1);check('simultaneous duplicate retries commit exactly one operation');
 const pristine=await snapshot();for(const invalid of [args(-1),args(9007199254740991),args(1,null),args(1,crypto.randomUUID(),null),args(1,crypto.randomUUID(),{}),args(1,crypto.randomUUID(),data(),'')])await assert.rejects(c.query(sql,invalid),/PREVISAO_INVALIDA/);assert.deepEqual(await snapshot(),pristine);check('invalid SQL inputs leave every record unchanged');
 await clean();await c.query(`create function public.synthetic_fail_operation() returns trigger language plpgsql as $$ begin if new.store='previsao_custo_operacoes' then raise exception 'SYNTHETIC_FAILURE'; end if; return new; end $$;
 create trigger synthetic_fail_operation before insert on public.dmd_kv for each row execute function public.synthetic_fail_operation();`);
 await assert.rejects(a.query(sql,args()),/SYNTHETIC_FAILURE/);assert.equal((await c.query("select count(*)::int n from public.dmd_kv where store in ('previsao_custo','previsao_custo_operacoes')")).rows[0].n,0);assert.deepEqual(await snapshot(),before);check('operation persistence failure rolls back forecast and preserves unrelated rows');
 console.log(JSON.stringify({checks,passed:true,isolated:true}));
}finally{
 for(const client of clients){await client.query('rollback').catch(()=>{});await client.end().catch(()=>{});}
 await db.stop();
}
