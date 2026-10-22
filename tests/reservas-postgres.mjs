// Real PostgreSQL 17.6 integration; dependencies live outside the application.
// DIAMOND_PG_DEPS=/path/to/node_modules node tests/reservas-postgres.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const deps=process.env.DIAMOND_PG_DEPS;
if(!deps)throw Error('Set DIAMOND_PG_DEPS to the isolated embedded-postgres@17.6.0-beta.15 dependencies.');
const {default:EmbeddedPostgres}=await import(pathToFileURL(path.join(deps,'embedded-postgres/dist/index.js')));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'diamond-pg-reservas-'));
const db=new EmbeddedPostgres({databaseDir:directory,port:55439,user:'postgres',password:'isolated-fixture-only',persistent:false,postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const sql=name=>fs.readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const clients=[];let checks=0;
const check=label=>{checks++;console.log('PASS '+label);};
const cfg={tabelaId:'table-fixture',reajuste:0};
const before={id:'unit-fixture',unidade:'TESTE',status:'Reservado',precoBase:300000,desconto:.1,precoVersao:cfg.tabelaId};
const after={...before,status:'Disponível',precoBase:330000,desconto:0};
const event={id:'event-fixture',acao:'cancelar'};
const releaseSql='select public.dmd_reserva_confirmar($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::jsonb,$8,$9::jsonb) as result';
const args=(patch={})=>[before.id,before,after,event,null,null,null,true,cfg].map((v,i)=>Object.hasOwn(patch,i)?patch[i]:v);
const connect=async()=>{const c=db.getPgClient('postgres','127.0.0.1');await c.connect();clients.push(c);return c;};
try{
 await db.initialise();await db.start();const c=await connect(),a=await connect(),b=await connect();
 console.log((await c.query('select version()')).rows[0].version);
 await c.query(`create role anon;create role authenticated;create role service_role;
 create table public.dmd_kv(store text not null,key text not null,valor jsonb not null,atualizado_em timestamptz not null default now(),primary key(store,key));
 create table public.domo_vagas_estado(obra text primary key,revisao bigint not null,estado jsonb not null,atualizado_em timestamptz not null default now());
 alter table public.dmd_kv enable row level security;
 alter table public.domo_vagas_estado enable row level security;
 alter role service_role bypassrls;
 grant usage on schema public to service_role,anon,authenticated;
 grant all on public.dmd_kv,public.domo_vagas_estado to service_role;`);
 await c.query(await sql('202609200400_reservas_apartamentos.sql'));
 await c.query(await sql('202610051300_tabelas_precos.sql'));
 const seed=async()=>{await c.query('truncate public.dmd_kv,public.domo_vagas_estado');await c.query("insert into public.dmd_kv(store,key,valor) values('cfg','cfg',$1),('unidades',$2,$3)",[cfg,before.id,before]);};
 const snapshot=async()=>({kv:(await c.query('select * from public.dmd_kv order by store,key')).rows,parking:(await c.query('select * from public.domo_vagas_estado')).rows});
 await seed();const pristine=await snapshot();await c.query(await sql('20261022205628_liberacao_tabela_vigente.sql'));assert.deepEqual(await snapshot(),pristine);check('migration compiles without changing existing records');
 const signature='public.dmd_reserva_confirmar(text,jsonb,jsonb,jsonb,text,bigint,jsonb,boolean,jsonb)';
 for(const role of ['anon','authenticated']){
  assert.equal((await c.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed',[role,signature])).rows[0].allowed,false);
  await a.query('set role '+role);await assert.rejects(a.query(releaseSql,args()),{code:'42501'});await a.query('reset role');
 }
 assert.equal((await c.query('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') as allowed',[signature])).rows[0].allowed,true);check('anon/authenticated denied; service_role allowed');
 await a.query('set role service_role');assert.deepEqual((await a.query(releaseSql,args())).rows[0].result,after);await a.query('reset role');
 assert.equal((await c.query("select count(*)::int n from public.dmd_kv where store='reservas_historico'")).rows[0].n,1);check('service_role release commits unit and history');
 for(const [label,patch,expected] of [
  ['stale unit',{1:{...before,desconto:.2}},/RESERVA_CONFLITO/],
  ['stale table',{8:{...cfg,tabelaId:'old'}},/TABELA_CONFLITO/],
  ['missing table revision',{8:null},/TABELA_CONFLITO/],
  ['discount retained',{2:{...after,desconto:.1}},/DESCONTO_INVALIDO/]
 ]){await seed();const initial=await snapshot();await assert.rejects(c.query(releaseSql,args(patch)),expected);assert.deepEqual(await snapshot(),initial);check(label+' rolls back');}
 await seed();await c.query("insert into public.dmd_kv(store,key,valor) values('reservas',$1,'{\"em\":\"pending\"}'),('reservas_historico',$2,'{}')",[before.id,event.id]);
 await c.query("insert into public.domo_vagas_estado(obra,revisao,estado) values('diamond',1,'{}')");
 const rollback=await snapshot();await assert.rejects(c.query(releaseSql,args({4:'pending',5:1,6:{changed:true}})),{code:'23505'});assert.deepEqual(await snapshot(),rollback);check('history failure rolls back parking, unit and pending request');
 await seed();const reserved={...before,desconto:.2};
 await c.query('select public.dmd_reserva_confirmar($1,$2::jsonb,$3::jsonb,$4::jsonb,null,null,null,false)',[before.id,before,reserved,{id:'compat',acao:'atualizar'}]);check('eight-argument callers remain compatible for non-release operations');
 const blocked=async pid=>{for(let i=0;i<80;i++){if((await c.query('select cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n>0)return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Expected a real PostgreSQL row lock');};
 await seed();await a.query('begin');await a.query("update public.dmd_kv set valor=$1 where store='cfg' and key='cfg'",[{...cfg,tabelaId:'concurrent'}]);
 const pendingRelease=b.query(releaseSql,args()).then(()=>null,e=>e);await blocked(b.processID);await a.query('commit');assert.match((await pendingRelease).message,/TABELA_CONFLITO/);
 assert.deepEqual((await c.query("select valor from public.dmd_kv where store='unidades'")).rows[0].valor,before);check('concurrent table change blocks then rejects stale release');
 await seed();await a.query('begin');await a.query(releaseSql,args());
 const priceParams=['next-table',cfg,{...cfg,tabelaId:'next-table'},{[before.id]:before},{[before.id]:{...before,precoVersao:'next-table'}},{id:'next-table',solicitacaoHash:'fixture'}];
 const pendingPrice=b.query('select public.dmd_precos_aplicar($1,$2,$3,$4,$5,$6)',priceParams).then(()=>null,e=>e);await blocked(b.processID);await a.query('commit');assert.match((await pendingPrice).message,/UNIDADES_CONFLITO/);check('concurrent repricing waits for release and rejects stale snapshot without deadlock');
 await seed();const results=await Promise.all([a,b].map((client,i)=>client.query(releaseSql,args({3:{...event,id:'simultaneous-'+i}})).then(()=>true,()=>false)));assert.equal(results.filter(Boolean).length,1);
 assert.equal((await c.query("select count(*)::int n from public.dmd_kv where store='reservas_historico'")).rows[0].n,1);check('two concurrent releases produce exactly one history record');
 console.log(JSON.stringify({checks,passed:true,isolated:true}));
}finally{
 for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}
 await db.stop();
}
