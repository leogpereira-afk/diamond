-- Controle de concorrência da área Domo. Somente o servidor autenticado executa.
create or replace function public.dmd_negociacao_salvar(p_id text,p_revisao integer,p_registro jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare atual jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('domo-negociacoes',0));
 if coalesce(p_registro->>'propostaId','')<>'' and p_registro->>'etapa' not in ('concluida','cancelada') and exists(select 1 from public.dmd_kv where store='negociacoes' and key<>p_id and valor->>'propostaId'=p_registro->>'propostaId' and valor->>'etapa' not in ('concluida','cancelada')) then raise exception 'NEGOCIACAO_CONFLITO'; end if;
 select valor into atual from public.dmd_kv where store='negociacoes' and key=p_id for update;
 if coalesce((atual->>'revisao')::integer,0)<>p_revisao then raise exception 'NEGOCIACAO_CONFLITO'; end if;
 if p_registro->>'id'<>p_id or (p_registro->>'revisao')::integer<>p_revisao+1 then raise exception 'NEGOCIACAO_INVALIDA'; end if;
 insert into public.dmd_kv(store,key,valor) values('negociacoes',p_id,p_registro)
 on conflict(store,key) do update set valor=excluded.valor;
end $$;
revoke all on function public.dmd_negociacao_salvar(text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.dmd_negociacao_salvar(text,integer,jsonb) to service_role;
