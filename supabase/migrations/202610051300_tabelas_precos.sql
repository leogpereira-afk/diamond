-- A price version and its comparison history commit together. RPCs are server-only.
create or replace function public.dmd_cfg_salvar(p_antes jsonb,p_depois jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare atual jsonb;
begin
 select valor into atual from public.dmd_kv where store='cfg' and key='cfg' for update;
 if atual is distinct from p_antes then raise exception 'CFG_CONFLITO'; end if;
 update public.dmd_kv set valor=p_depois,atualizado_em=now() where store='cfg' and key='cfg';
 return p_depois;
end $$;
revoke all on function public.dmd_cfg_salvar(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dmd_cfg_salvar(jsonb,jsonb) to service_role;

create or replace function public.dmd_unidade_criar(p_id text,p_unidade jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare configuracao jsonb; existente jsonb; nova jsonb;
begin
 -- Same first lock as dmd_precos_aplicar: unit insertion cannot race its snapshot.
 select valor into configuracao from public.dmd_kv where store='cfg' and key='cfg' for update;
 select valor into existente from public.dmd_kv where store='unidades' and key=p_id for update;
 if existente is not null then raise exception 'UNIDADE_CONFLITO'; end if;
 if p_unidade->>'id' is distinct from p_id then raise exception 'UNIDADE_INVALIDA'; end if;
 nova := p_unidade - 'precoVersao';
 if coalesce(configuracao->>'tabelaId','')<>'' then
  nova := nova || jsonb_build_object('precoVersao',configuracao->>'tabelaId');
 end if;
 insert into public.dmd_kv(store,key,valor,atualizado_em) values('unidades',p_id,nova,now());
 return nova;
end $$;
revoke all on function public.dmd_unidade_criar(text,jsonb) from public,anon,authenticated;
grant execute on function public.dmd_unidade_criar(text,jsonb) to service_role;

create or replace function public.dmd_precos_aplicar(p_operacao_id text,p_cfg_antes jsonb,p_cfg_depois jsonb,p_unidades_antes jsonb,p_unidades_depois jsonb,p_evento jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare atual_cfg jsonb; atuais jsonb; anterior jsonb; registro record; resposta jsonb;
begin
 -- The config lock serializes price versions and all ordinary config saves.
 select valor into atual_cfg from public.dmd_kv where store='cfg' and key='cfg' for update;
 select valor into anterior from public.dmd_kv where store='precos_historico' and key=p_operacao_id;
 if anterior is not null then
  if anterior->>'solicitacaoHash' is distinct from p_evento->>'solicitacaoHash' then raise exception 'OPERACAO_CONFLITO'; end if;
  select coalesce(jsonb_agg(valor order by key),'[]'::jsonb) into resposta from public.dmd_kv where store='unidades';
  return jsonb_build_object('repetida',true,'cfg',atual_cfg,'unidades',resposta,'historico',anterior);
 end if;
 if atual_cfg is distinct from p_cfg_antes then raise exception 'CFG_CONFLITO'; end if;
 -- These are the same row locks used by apartment reservation/sale operations.
 perform key from public.dmd_kv where store='unidades' order by key for update;
 select coalesce(jsonb_object_agg(key,valor),'{}'::jsonb) into atuais from public.dmd_kv where store='unidades';
 if atuais is distinct from p_unidades_antes then raise exception 'UNIDADES_CONFLITO'; end if;
 if (select array_agg(key order by key) from jsonb_each(p_unidades_antes)) is distinct from (select array_agg(key order by key) from jsonb_each(p_unidades_depois)) then raise exception 'UNIDADES_CONFLITO'; end if;
 for registro in select key,value from jsonb_each(p_unidades_depois) loop
  anterior := p_unidades_antes->registro.key;
  if anterior is distinct from registro.value then
   if anterior->'precoBase' is distinct from registro.value->'precoBase' and (anterior->>'status' is distinct from 'Disponível' or coalesce((anterior->>'precoBase')::numeric,0)<=0) then raise exception 'UNIDADE_INDISPONIVEL'; end if;
   if (anterior - array['precoBase','precoVersao','atualizadoEm','atualizadoPor']) is distinct from (registro.value - array['precoBase','precoVersao','atualizadoEm','atualizadoPor']) then raise exception 'PRECO_INVALIDO'; end if;
   update public.dmd_kv set valor=registro.value,atualizado_em=now() where store='unidades' and key=registro.key;
  end if;
 end loop;
 update public.dmd_kv set valor=p_cfg_depois,atualizado_em=now() where store='cfg' and key='cfg';
 insert into public.dmd_kv(store,key,valor,atualizado_em) values('precos_historico',p_operacao_id,p_evento,now());
 select coalesce(jsonb_agg(valor order by key),'[]'::jsonb) into resposta from public.dmd_kv where store='unidades';
 return jsonb_build_object('repetida',false,'cfg',p_cfg_depois,'unidades',resposta,'historico',p_evento);
end $$;
revoke all on function public.dmd_precos_aplicar(text,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dmd_precos_aplicar(text,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
