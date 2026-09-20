-- Atomic confirmation: unit, pending request, parking adjustment and history commit together.
create or replace function public.dmd_reserva_confirmar(p_id text,p_antes jsonb,p_depois jsonb,p_evento jsonb,p_pedido_em text default null,p_vagas_revisao bigint default null,p_vagas_estado jsonb default null,p_resolver_pedido boolean default true)
returns jsonb language plpgsql set search_path=public as $$
declare atual jsonb; pedido jsonb; rev bigint;
begin
 select valor into atual from public.dmd_kv where store='unidades' and key=p_id for update;
 if atual is null or atual is distinct from p_antes then raise exception 'RESERVA_CONFLITO'; end if;
 select valor into pedido from public.dmd_kv where store='reservas' and key=p_id for update;
 if p_resolver_pedido and p_pedido_em is null and pedido is not null then raise exception 'PEDIDO_CONFLITO'; end if;
 if p_pedido_em is not null and coalesce(pedido->>'em','')<>p_pedido_em then raise exception 'PEDIDO_CONFLITO'; end if;
 if p_vagas_estado is not null then
  update public.domo_vagas_estado set estado=p_vagas_estado,revisao=revisao+1,atualizado_em=now() where obra='diamond' and revisao=p_vagas_revisao returning revisao into rev;
  if rev is null then raise exception 'VAGAS_CONFLITO'; end if;
 end if;
 update public.dmd_kv set valor=p_depois,atualizado_em=now() where store='unidades' and key=p_id;
 insert into public.dmd_kv(store,key,valor,atualizado_em) values('reservas_historico',p_evento->>'id',p_evento,now());
 if p_resolver_pedido then delete from public.dmd_kv where store='reservas' and key=p_id; end if;
 return p_depois;
end $$;
revoke all on function public.dmd_reserva_confirmar(text,jsonb,jsonb,jsonb,text,bigint,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.dmd_reserva_confirmar(text,jsonb,jsonb,jsonb,text,bigint,jsonb,boolean) to service_role;

create or replace function public.dmd_reserva_pedir(p_id text,p_valor jsonb)
returns boolean language plpgsql set search_path=public as $$
declare atual jsonb; inserted integer;
begin
 select valor into atual from public.dmd_kv where store='unidades' and key=p_id for update;
 if atual is null or atual->>'status'<>'Disponível' then raise exception 'UNIDADE_INDISPONIVEL'; end if;
 insert into public.dmd_kv(store,key,valor,atualizado_em) values('reservas',p_id,p_valor,now()) on conflict(store,key) do nothing;
 get diagnostics inserted=row_count;
 return inserted=1;
end $$;
revoke all on function public.dmd_reserva_pedir(text,jsonb) from public,anon,authenticated;
grant execute on function public.dmd_reserva_pedir(text,jsonb) to service_role;
