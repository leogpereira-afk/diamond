-- Ledger independente das vendas. Somente a API com service_role pode gravar.
-- Nenhuma condição, valor vendido, cadastro ou parcela é alterado por esta RPC.
create or replace function public.dmd_caixa_recebimento_salvar(
 p_id text,p_unidade_antes jsonb,p_cliente_antes jsonb,p_condicoes_antes jsonb,
 p_antes jsonb,p_depois jsonb
) returns jsonb language plpgsql set search_path=public as $$
declare
 atual jsonb; unidade_atual jsonb; cliente_atual jsonb; condicoes_atual jsonb;
 novo jsonb; repetido jsonb; original jsonb; qtd integer; cliente_id text;
begin
 if p_id is null or p_id='' or length(p_id)>80
    or jsonb_typeof(p_depois) is distinct from 'object'
    or p_depois->>'unidadeId' is distinct from p_id
    or jsonb_typeof(p_depois->'eventos') is distinct from 'array'
 then raise exception 'CAIXA_INVALIDO'; end if;
 qtd := jsonb_array_length(p_depois->'eventos');
 if qtd<1 or qtd>10000 then raise exception 'CAIXA_LIMITE'; end if;
 novo := p_depois->'eventos'->(qtd-1);
 if jsonb_typeof(novo) is distinct from 'object'
    or coalesce(novo->>'tipo','') not in ('receber','estornar')
    or coalesce(novo->>'operacaoId','') !~ '^[a-zA-Z0-9_-]{16,100}$'
    or coalesce(novo->>'id','') !~ '^[a-zA-Z0-9_-]{1,100}$'
    or jsonb_typeof(novo->'solicitacao') is distinct from 'string'
    or length(novo->>'solicitacao') not between 2 and 50000
    or coalesce(novo->>'valor','') !~ '^[1-9][0-9]{0,12}$'
    or (novo->>'valor')::numeric>1000000000000
    or coalesce(novo->>'data','') !~ '^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    or coalesce(novo->>'por','')='' or coalesce(novo->>'em','')=''
    or coalesce(novo->>'parcelaId','')='' or coalesce(novo->>'cronogramaChave','')=''
 then raise exception 'CAIXA_INVALIDO'; end if;
 -- A data precisa existir no calendário (não apenas obedecer ao formato).
 if to_char((novo->>'data')::date,'YYYY-MM-DD')<>novo->>'data' then raise exception 'CAIXA_DATA_INVALIDA'; end if;

 -- A mesma ordem do cadastro e das condições: cliente → unidade → condição.
 -- A unidade serializa também a criação do primeiro ledger (linha inexistente).
 if novo->>'tipo'='receber' then
  cliente_id := p_unidade_antes->>'clienteId';
  select valor into cliente_atual from public.dmd_kv where store='leads' and key=cliente_id for update;
 end if;
 select valor into unidade_atual from public.dmd_kv where store='unidades' and key=p_id for update;
 if novo->>'tipo'='receber' then
  select valor into condicoes_atual from public.dmd_kv where store='vendas_condicoes' and key=p_id for update;
 end if;
 select valor into atual from public.dmd_kv where store='vendas_recebimentos' and key=p_id for update;

 -- Repetição após queda de rede/depois de outra operação: devolve a posição
 -- atual, sem duplicar o evento e sem exigir novamente a revisão antiga.
 select e into repetido from jsonb_array_elements(coalesce(atual->'eventos','[]'::jsonb)) e
 where e->>'operacaoId'=novo->>'operacaoId';
 if repetido is not null then
  if repetido->>'solicitacao' is distinct from novo->>'solicitacao' then raise exception 'OPERACAO_CONFLITO'; end if;
  return jsonb_build_object('registro',atual,'repetida',true);
 end if;
 if atual is distinct from p_antes
    or (p_depois->>'revisao')::bigint is distinct from coalesce((atual->>'revisao')::bigint,0)+1
    or qtd<>jsonb_array_length(coalesce(atual->'eventos','[]'::jsonb))+1
    or ((p_depois->'eventos')-(qtd-1)) is distinct from coalesce(atual->'eventos','[]'::jsonb)
    or exists(select 1 from jsonb_array_elements(coalesce(atual->'eventos','[]'::jsonb)) e where e->>'id'=novo->>'id')
 then raise exception 'RECEBIMENTO_CONFLITO'; end if;

 if novo->>'tipo'='receber' then
  if cliente_atual is null or cliente_atual is distinct from p_cliente_antes then raise exception 'CLIENTE_CONFLITO'; end if;
  if unidade_atual is null or unidade_atual is distinct from p_unidade_antes then raise exception 'UNIDADE_CONFLITO'; end if;
  if condicoes_atual is null or condicoes_atual is distinct from p_condicoes_antes then raise exception 'CONDICOES_CONFLITO'; end if;
  if unidade_atual->>'status' is distinct from 'Vendido'
     or condicoes_atual->>'unidadeId' is distinct from p_id
     or condicoes_atual->>'clienteId' is distinct from cliente_id
     or novo->'fonte'->>'clienteId' is distinct from cliente_id
  then raise exception 'VENDA_CONFLITO'; end if;
 else
  -- O estorno continua disponível após uma revisão do contrato ou reabertura.
  -- Ele aponta para o recebimento original e não escreve nem apaga a venda.
  select e into original from jsonb_array_elements(coalesce(atual->'eventos','[]'::jsonb)) e
  where e->>'id'=novo->>'eventoId' and e->>'tipo'='receber';
  if original is null
     or exists(select 1 from jsonb_array_elements(atual->'eventos') e where e->>'tipo'='estornar' and e->>'eventoId'=original->>'id')
     or novo->'valor' is distinct from original->'valor'
     or novo->>'parcelaId' is distinct from original->>'parcelaId'
     or novo->>'cronogramaChave' is distinct from original->>'cronogramaChave'
     or novo->'fonte' is distinct from original->'fonte'
     or coalesce(btrim(novo->>'motivo'),'')=''
  then raise exception 'ESTORNO_CONFLITO'; end if;
 end if;
 insert into public.dmd_kv(store,key,valor,atualizado_em) values('vendas_recebimentos',p_id,p_depois,now())
 on conflict(store,key) do update set valor=excluded.valor,atualizado_em=excluded.atualizado_em;
 return jsonb_build_object('registro',p_depois,'repetida',false);
end $$;
revoke all on function public.dmd_caixa_recebimento_salvar(text,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dmd_caixa_recebimento_salvar(text,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
