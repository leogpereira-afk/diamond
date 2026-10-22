-- Local migration: deploy before the API; no production data is modified here.
-- Remove the old overload; other operations remain compatible through defaults.
drop function public.dmd_reserva_confirmar(text,jsonb,jsonb,jsonb,text,bigint,jsonb,boolean);
-- Atomic confirmation: unit, pending request, parking adjustment and history commit together.
create or replace function public.dmd_reserva_confirmar(p_id text,p_antes jsonb,p_depois jsonb,p_evento jsonb,p_pedido_em text default null,p_vagas_revisao bigint default null,p_vagas_estado jsonb default null,p_resolver_pedido boolean default true,p_cfg_antes jsonb default null)
returns jsonb language plpgsql set search_path=public as $$
declare atual jsonb; pedido jsonb; rev bigint; cfg_atual jsonb;
begin
 -- Same lock order as dmd_precos_aplicar: config before unit.
 if p_depois->>'status'='Disponível' and p_antes->>'status' in ('Reservado','Vendido') then
  if p_cfg_antes is null then raise exception 'TABELA_CONFLITO'; end if;
  select valor into cfg_atual from public.dmd_kv where store='cfg' and key='cfg' for update;
  if cfg_atual is null or cfg_atual is distinct from p_cfg_antes then raise exception 'TABELA_CONFLITO'; end if;
  if coalesce((p_depois->>'desconto')::numeric,-1)<>0 then raise exception 'DESCONTO_INVALIDO'; end if;
 end if;
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
revoke all on function public.dmd_reserva_confirmar(text,jsonb,jsonb,jsonb,text,bigint,jsonb,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.dmd_reserva_confirmar(text,jsonb,jsonb,jsonb,text,bigint,jsonb,boolean,jsonb) to service_role;
