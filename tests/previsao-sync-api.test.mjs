import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {backend,copy,source} from './helpers.mjs';
import {executarPrevisaoCusto} from '../supabase/functions/dmd-api/previsao-custo-api.mjs';
const schema=globalThis.DiamondPrevisaoSchema;
const fixture=()=>({...schema.defaults(),contributionsReviewed:true,contributions:[{id:'aporte-fixture',socio:'Sócio sintético privado',data:'2026-01-01',valorCents:12345,observacao:'Teste de sincronização'}]});
const save=(dados=fixture(),revisao=0,operacaoId=crypto.randomUUID())=>({operacao:'salvar',revisao,operacaoId,dados});
const load=b=>b.request('previsaoCusto',{operacao:'carregar'});

test('previsão exige autenticação da gestão na leitura e na gravação',async()=>{
 const b=backend();b.table('cfg').get('usuarios').push({usuario:'externo',papel:'corretor',hash:'fake',ativo:true},{usuario:'inativo',papel:'admin',hash:'fake',ativo:false});
 for(const user of [null,'cliente','externo','inativo','inexistente'])for(const body of [{operacao:'carregar'},save()])assert.equal((await b.request('previsaoCusto',body,user)).status,403,user);
 assert.equal(b.table('previsao_custo').size,0);assert.equal(b.table('previsao_custo_operacoes').size,0);
 assert.equal(b.reads.includes('previsao_custo'),false);
 assert.equal((await b.request('previsaoCusto',{operacao:'carregar'},'domo','errado')).status,401);
 for(const user of ['admin','domo'])assert.equal((await b.request('previsaoCusto',{operacao:'carregar'},user)).status,200);
});
test('primeiro carregamento devolve padrão de revisão zero sem persistir valores fictícios',async()=>{
 const b=backend(),r=await load(b);assert.equal(r.status,200);assert.equal(r.registro.revision,0);assert.equal(r.registro.updatedAt,null);assert.deepEqual(r.registro.data,schema.defaults());
 assert.equal(b.table('previsao_custo').size,0);assert.equal(b.table('previsao_custo_operacoes').size,0);
});
test('segundo dispositivo lê o registro compartilhado e autoria vem da sessão validada',async()=>{
 const b=backend(),body={...save(),updatedAt:'1999-01-01T00:00:00.000Z',updatedBy:'forjado'};
 const first=await b.request('previsaoCusto',body,'admin');assert.equal(first.status,200,first.erro);assert.equal(first.registro.status,'Salvo no sistema');assert.equal(first.registro.revision,1);assert.equal(first.registro.updatedBy,'admin');assert.notEqual(first.registro.updatedAt,body.updatedAt);
 const second=await load(b);assert.deepEqual(second.registro,first.registro);assert.deepEqual(second.registro.data,fixture());
 assert.equal(b.table('previsao_custo').size,1);assert.equal(b.table('previsao_custo_operacoes').size,1);assert.equal(b.table('cfg').get('cfg').previsao_custo,undefined);
});
test('validação rejeita conteúdo inválido sem alterar registro nem idempotência',async()=>{
 const b=backend();assert.equal((await b.request('previsaoCusto',save())).status,200);const before=copy(b.table('previsao_custo').get('diamond'));
 const invalid=[null,{...fixture(),unexpected:true},{...fixture(),settings:{...schema.defaults().settings,targetCents:-1}},{...fixture(),contributions:[{...fixture().contributions[0],data:'2026-02-30'}]},{...fixture(),contributions:[{...fixture().contributions[0],valorCents:1.5}]},{...fixture(),receipts:[{id:'bad'}]},{...fixture(),contributions:[fixture().contributions[0],fixture().contributions[0]]}];
 for(const data of invalid)assert.equal((await b.request('previsaoCusto',save(data,1))).status,400);
 for(const patch of [{revisao:-1},{revisao:1.1},{revisao:'1'},{revisao:Number.MAX_SAFE_INTEGER},{operacaoId:'sem-uuid'}])assert.equal((await b.request('previsaoCusto',{...save(fixture(),1),...patch})).status,400);
 const oversized={...fixture(),contributions:Array.from({length:500},(_,i)=>({...fixture().contributions[0],id:'big-'+i,observacao:'á'.repeat(2000)}))};assert.equal((await b.request('previsaoCusto',save(oversized,1))).status,400);
 assert.deepEqual(b.table('previsao_custo').get('diamond'),before);assert.equal(b.table('previsao_custo_operacoes').size,1);
});
test('duas primeiras gravações concorrentes produzem uma revisão e um conflito',async()=>{
 const b=backend(),other={...fixture(),contributionsReviewed:false};
 const results=await Promise.all([b.request('previsaoCusto',save()),b.request('previsaoCusto',save(other))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(b.table('previsao_custo').get('diamond').revision,1);assert.equal(b.table('previsao_custo_operacoes').size,1);
});
test('revisão desatualizada não sobrescreve edição de outro dispositivo',async()=>{
 const b=backend(),a=await load(b),z=await load(b);const first=await b.request('previsaoCusto',save(fixture(),a.registro.revision));assert.equal(first.status,200);
 const stale=await b.request('previsaoCusto',save(schema.defaults(),z.registro.revision));assert.equal(stale.status,409);assert.deepEqual((await load(b)).registro,first.registro);
});
test('retry idempotente aceita ordem diferente das propriedades sem gravar duas vezes',async()=>{
 const b=backend(),body=save(),first=await b.request('previsaoCusto',body);assert.equal(first.status,200);
 const reordered=Object.fromEntries(Object.entries(body.dados).reverse());reordered.settings=Object.fromEntries(Object.entries(reordered.settings).reverse());
 const again=await b.request('previsaoCusto',{...body,dados:reordered});assert.equal(again.status,200);assert.equal(again.repetida,true);assert.deepEqual(again.registro,first.registro);assert.equal(b.table('previsao_custo_operacoes').size,1);
});
test('reutilização do ID com outro conteúdo, revisão ou ator é recusada',async()=>{
 const b=backend(),body=save(),first=await b.request('previsaoCusto',body);
 for(const [patch,user]of [[{dados:schema.defaults()},'domo'],[{revisao:1},'domo'],[{},'admin']])assert.equal((await b.request('previsaoCusto',{...body,...patch},user)).status,409);
 assert.deepEqual((await load(b)).registro,first.registro);assert.equal(b.table('previsao_custo_operacoes').size,1);
});
test('retry antigo após uma edição posterior devolve a versão corrente sem reversão',async()=>{
 const b=backend(),old=save();assert.equal((await b.request('previsaoCusto',old)).status,200);
 const newer=await b.request('previsaoCusto',save(schema.defaults(),1),'admin');assert.equal(newer.status,200);
 const retry=await b.request('previsaoCusto',old);assert.equal(retry.status,200);assert.equal(retry.repetida,true);assert.deepEqual(retry.registro,newer.registro);assert.deepEqual((await load(b)).registro,newer.registro);assert.equal(b.table('previsao_custo_operacoes').size,2);
});
test('falha antes do commit não grava e resposta perdida é recuperada pelo mesmo ID',async()=>{
 const offline=backend({failPrevisaoCommit:true});assert.equal((await offline.request('previsaoCusto',save())).status,503);assert.equal(offline.table('previsao_custo').size,0);
 const b=backend({losePrevisaoResponse:true}),body=save();assert.equal((await b.request('previsaoCusto',body)).status,503);assert.equal(b.table('previsao_custo').get('diamond').revision,1);
 const again=await b.request('previsaoCusto',body);assert.equal(again.status,200);assert.equal(again.repetida,true);assert.equal(again.registro.revision,1);assert.equal(b.table('previsao_custo_operacoes').size,1);
});
test('falha de leitura ou registro corrompido impede substituir os dados por padrão vazio',async()=>{
 const b=backend();b.table('previsao_custo').set('diamond',{revision:9,data:{}});const before=copy(b.table('previsao_custo').get('diamond'));assert.equal((await load(b)).status,503);assert.deepEqual(b.table('previsao_custo').get('diamond'),before);
 const result=await executarPrevisaoCusto({operacao:'carregar'},{usuario:'domo'},{getStore:()=>({get:async()=>{throw Error('offline');}})});assert.equal(result.status,503);
});
test('configuração, listagem normal e link público não expõem previsão; backup inclui as duas stores',async()=>{
 const b=backend(),saved=await b.request('previsaoCusto',save());assert.equal(saved.status,200);
 for(const user of [null,'cliente','domo','admin'])for(const action of ['getCfg','list']){const response=await b.request(action,{},user);assert.equal(JSON.stringify(response).includes('Sócio sintético privado'),false);assert.equal(JSON.stringify(response).includes('requestHash'),false);}
 b.table('envios').set('pp-aaaaaaaaaaaaaaaa',{cliente:'Cliente de teste',corretor:'Corretor de teste',valor:100});const publicResponse=await b.publicGet({preview:'1'});assert.equal(JSON.stringify(publicResponse).includes('Sócio sintético privado'),false);
 const backup=await b.request('list',{},null,'fake-backup');assert.equal(backup.status,200);assert.ok(backup.registros.some(r=>r._col==='previsao_custo'&&r._key==='diamond'));assert.ok(backup.registros.some(r=>r._col==='previsao_custo_operacoes'));
});
test('schema usado no servidor é idêntico ao schema entregue ao navegador',()=>{
 assert.equal(source('previsao-custo-schema.js'),source('supabase/functions/dmd-api/previsao-custo-schema.js'));
});
