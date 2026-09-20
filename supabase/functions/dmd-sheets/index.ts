import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';
import '../dmd-api/vagas-domain.js';
import {reconcile,confirm} from './sync.mjs';
const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
 if(req.method!=='POST')return reply(405,{erro:'Use POST.'});
 try {
  const {data:cfg}=await sb.from('dmd_kv').select('valor').eq('store','integracoes_privadas').eq('key','sheets_diamond').maybeSingle();
  if(!cfg?.valor?.audience)return reply(503,{erro:'Conexão aguardando autorização e configuração.'});
  const token=req.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  let claims;try{claims=(await jwtVerify(token,keys,{audience:cfg.valor.audience,issuer:['https://accounts.google.com','accounts.google.com']})).payload;}catch{return reply(401,{erro:'Identificação Google inválida.'});}
  if(claims.email!==cfg.valor.email||claims.email_verified!==true)return reply(403,{erro:'Conta não autorizada.'});
  if(Number(req.headers.get('content-length')||0)>400000)return reply(413,{erro:'Dados excessivos.'});
  const text=await req.text();if(text.length>400000)return reply(413,{erro:'Dados excessivos.'});
  const b=JSON.parse(text);if(!['trocar','confirmar','abortar'].includes(b.operacao))return reply(400,{erro:'Operação inválida.'});
  const {data:row,error}=await sb.from('domo_vagas_estado').select('estado,revisao').eq('obra','diamond').single();
  if(error)throw Error('Base indisponível.');
  const V=(globalThis as any).DomoVagas,now=new Date().toISOString();let novo;
  if(b.operacao==='abortar'){
   if(row.estado.sync?.pendente?.id!==b.id)throw Error('Operação não encontrada.');
   novo=structuredClone(row.estado);novo.sync.conflitos=[...new Set([...(novo.sync.conflitos||[]),...novo.sync.pendente.codigos])];novo.sync.pendente=null;novo.sync.erro='Edição simultânea na planilha: conferir os vínculos.';
  }else if(b.operacao==='confirmar')novo=confirm(V,row.estado,b.fonte,b.id,now,cfg.valor.spreadsheetId);
  else{
   if(b.fonte?.spreadsheetId!==cfg.valor.spreadsheetId)throw Error('Planilha não autorizada.');
   if(row.estado.sync?.pendente)return reply(200,{ok:true,pendente:row.estado.sync.pendente});
   novo=reconcile(V,row.estado,b.fonte,now,crypto.randomUUID(),cfg.valor.spreadsheetId);
  }
  const {error:e}=await sb.rpc('domo_vagas_salvar',{p_revisao:row.revisao,p_estado:novo});
  if(e)return reply(409,{erro:'O Diamond mudou durante a conferência. Tente novamente.'});
  return reply(200,{ok:true,pendente:novo.sync?.pendente,alertas:(novo.sync?.conflitos||[]).length});
 }catch(e){return reply(400,{erro:(e as Error).message||'Não foi possível sincronizar.'});}
});
