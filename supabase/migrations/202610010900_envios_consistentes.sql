-- Apenas o backend pode incrementar números e interações. Nenhum envio antigo é renumerado.
create or replace function public.dmd_envio_numero() returns bigint
language plpgsql security definer set search_path=public as $$
declare n bigint; maior bigint;
begin
 perform pg_advisory_xact_lock(734101);
 select coalesce(max((valor->>'numero')::bigint),0) into maior from dmd_kv where store='envios' and (valor->>'numero') ~ '^[0-9]+$';
 select greatest(coalesce((valor #>> '{}')::bigint,0),maior)+1 into n from dmd_kv where store='cfg' and key='seqEnvio' for update;
 n:=coalesce(n,maior+1);
 insert into dmd_kv(store,key,valor,atualizado_em) values('cfg','seqEnvio',to_jsonb(n),now()) on conflict(store,key) do update set valor=excluded.valor,atualizado_em=excluded.atualizado_em;
 return n;
end; $$;
create or replace function public.dmd_envio_evento(p_id text,p_tipo text,p_chave text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v jsonb; n integer; instante text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 if p_tipo not in ('abertura','abriu_pdf','interesse','duvida') then raise exception 'Evento inválido'; end if;
 select valor into v from dmd_kv where store='envios' and key=p_id for update;
 if v is null then return jsonb_build_object('status',404); end if;
 if p_tipo='abertura' then
  v:=v||jsonb_build_object('views',coalesce((v->>'views')::int,0)+1,'lastView',instante,'firstView',coalesce(v->>'firstView',instante));
 else
  if p_tipo in ('interesse','duvida') then
   -- Contagem independente dos acessos ao PDF, inclusive para links antigos.
   select count(*) into n from dmd_kv where store='enviosEv' and valor->>'envioId'=p_id and valor->>'tipo' in ('interesse','duvida');
   if n>=50 then return jsonb_build_object('status',429); end if;
  end if;
  insert into dmd_kv(store,key,valor,atualizado_em) values('enviosEv',p_chave,jsonb_build_object('envioId',p_id,'tipo',p_tipo,'em',instante),now());
 end if;
 update dmd_kv set valor=v,atualizado_em=now() where store='envios' and key=p_id;
 return jsonb_build_object('status',200);
end; $$;
revoke all on function public.dmd_envio_numero() from public,anon,authenticated;
revoke all on function public.dmd_envio_evento(text,text,text) from public,anon,authenticated;
grant execute on function public.dmd_envio_numero() to service_role;
grant execute on function public.dmd_envio_evento(text,text,text) to service_role;
create or replace function public.dmd_envio_acompanhar(p_id text,p_dados jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 update dmd_kv set valor=jsonb_set(valor,'{acompanhamento}',p_dados),atualizado_em=now() where store='envios' and key=p_id;
 return found;
end; $$;
revoke all on function public.dmd_envio_acompanhar(text,jsonb) from public,anon,authenticated;
grant execute on function public.dmd_envio_acompanhar(text,jsonb) to service_role;
