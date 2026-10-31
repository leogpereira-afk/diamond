-- O valor da venda e sua tabela de referência são gravados juntos. Nenhum preço,
-- status, reserva ou dado cadastral da unidade é modificado por esta operação.
create or replace function public.dmd_venda_condicoes_salvar(
 p_id text,p_unidade_antes jsonb,p_cliente_antes jsonb,p_antes jsonb,p_depois jsonb,
 p_fonte_store text,p_fonte_key text,p_fonte_antes jsonb
) returns jsonb language plpgsql set search_path=public as $$
declare atual jsonb; unidade_atual jsonb; cliente_id text;
begin
 if p_id is null or p_id='' or jsonb_typeof(p_depois) is distinct from 'object' then raise exception 'VENDA_INVALIDA'; end if;
 -- Fonte atual segue a mesma ordem de locks do reajuste (configuração antes da
 -- unidade). Para histórico, a linha exata que originou a escolha fica travada.
 if p_fonte_store is not null then
  if p_fonte_store not in ('cfg','precos_historico') or p_fonte_key is null
     or (p_fonte_store='cfg' and p_fonte_key<>'cfg') then raise exception 'TABELA_INVALIDA'; end if;
  select valor into atual from public.dmd_kv where store=p_fonte_store and key=p_fonte_key for update;
  if atual is null or atual is distinct from p_fonte_antes then raise exception 'TABELA_CONFLITO'; end if;
 end if;
 -- Cadastro de cliente também trava o cliente antes de vincular a unidade.
 cliente_id := p_unidade_antes->>'clienteId';
 select valor into atual from public.dmd_kv where store='leads' and key=cliente_id for update;
 if atual is null or atual is distinct from p_cliente_antes then raise exception 'CLIENTE_CONFLITO'; end if;
 select valor into unidade_atual from public.dmd_kv where store='unidades' and key=p_id for update;
 if unidade_atual is null or unidade_atual is distinct from p_unidade_antes then raise exception 'UNIDADE_CONFLITO'; end if;
 if unidade_atual->>'status' is distinct from 'Vendido' or unidade_atual->>'clienteId' is distinct from cliente_id
    or p_depois->>'unidadeId' is distinct from p_id or p_depois->>'clienteId' is distinct from cliente_id
    or p_depois->>'unidadeRevisao' is distinct from unidade_atual->>'atualizadoEm' then raise exception 'VENDA_INVALIDA'; end if;
 -- A unidade travada também serializa a criação do primeiro contrato, mesmo
 -- quando ainda não existe linha de condições para receber FOR UPDATE.
 select valor into atual from public.dmd_kv where store='vendas_condicoes' and key=p_id for update;
 if atual is distinct from p_antes then raise exception 'CONDICOES_CONFLITO'; end if;
 if (p_depois->>'revisao')::bigint is distinct from coalesce((atual->>'revisao')::bigint,0)+1 then raise exception 'CONDICOES_CONFLITO'; end if;
 insert into public.dmd_kv(store,key,valor,atualizado_em) values('vendas_condicoes',p_id,p_depois,now())
 on conflict(store,key) do update set valor=excluded.valor,atualizado_em=excluded.atualizado_em;
 return p_depois;
end $$;
revoke all on function public.dmd_venda_condicoes_salvar(text,jsonb,jsonb,jsonb,jsonb,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.dmd_venda_condicoes_salvar(text,jsonb,jsonb,jsonb,jsonb,text,text,jsonb) to service_role;
