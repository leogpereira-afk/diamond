-- Cliente e vínculo com unidade são confirmados juntos, sem mudar situação/preço.
create or replace function public.dmd_cliente_salvar(p_id text,p_antes jsonb,p_depois jsonb,p_unidade_id text,p_unidade_antes jsonb,p_unidade_depois jsonb,p_evento jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare atual jsonb; doc text;
begin
 perform pg_advisory_xact_lock(hashtext('dmd_cliente_cadastro'));
 select valor into atual from public.dmd_kv where store='leads' and key=p_id for update;
 if atual is distinct from p_antes then raise exception 'CLIENTE_CONFLITO'; end if;
 if p_depois->>'id' is distinct from p_id then raise exception 'CLIENTE_INVALIDO'; end if;
 doc := upper(regexp_replace(coalesce(p_depois->'cadastro'->>'documento',''),'[^a-zA-Z0-9]','','g'));
 if doc<>'' and exists(select 1 from public.dmd_kv where store='leads' and key<>p_id and upper(regexp_replace(coalesce(valor->'cadastro'->>'documento',''),'[^a-zA-Z0-9]','','g'))=doc) then raise exception 'DOCUMENTO_DUPLICADO'; end if;
 if p_unidade_id is not null then
  select valor into atual from public.dmd_kv where store='unidades' and key=p_unidade_id for update;
  if atual is null or atual is distinct from p_unidade_antes then raise exception 'UNIDADE_CONFLITO'; end if;
  if p_unidade_depois->>'status' is distinct from atual->>'status' or p_unidade_depois->'precoBase' is distinct from atual->'precoBase' or p_unidade_depois->>'clienteId' is distinct from p_id then raise exception 'VINCULO_INVALIDO'; end if;
  update public.dmd_kv set valor=p_unidade_depois,atualizado_em=now() where store='unidades' and key=p_unidade_id;
 end if;
 insert into public.dmd_kv(store,key,valor,atualizado_em) values('leads',p_id,p_depois,now()) on conflict(store,key) do update set valor=excluded.valor,atualizado_em=excluded.atualizado_em;
 -- Outras unidades do mesmo cadastro acompanham o nome/telefone sem alterar o negócio.
 update public.dmd_kv set valor=valor || jsonb_build_object('clienteVinculadoNome',p_depois->>'cliente','atualizadoEm',p_depois->>'atualizadoEm') ||
  case when valor->>'status'='Vendido' then jsonb_build_object('compradorNome',p_depois->>'cliente') else '{}'::jsonb end ||
  case when valor->>'status'='Reservado' and jsonb_typeof(valor->'reserva')='object' then jsonb_build_object('reserva',(valor->'reserva')||jsonb_build_object('cliente',p_depois->>'cliente','telefone',p_depois->>'clienteTel')) else '{}'::jsonb end,
  atualizado_em=now()
 where store='unidades' and valor->>'clienteId'=p_id and key is distinct from p_unidade_id;
 insert into public.dmd_kv(store,key,valor,atualizado_em) values('clientes_historico',p_evento->>'id',p_evento,now());
 return jsonb_build_object('lead',p_depois,'unidades',(select coalesce(jsonb_agg(valor),'[]'::jsonb) from public.dmd_kv where store='unidades' and valor->>'clienteId'=p_id));
end $$;
revoke all on function public.dmd_cliente_salvar(text,jsonb,jsonb,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dmd_cliente_salvar(text,jsonb,jsonb,text,jsonb,jsonb,jsonb) to service_role;
