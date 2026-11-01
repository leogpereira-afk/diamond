-- Previsão compartilhada entre os dispositivos da gestão Diamond. Somente a
-- API autenticada usa esta função; os papéis públicos não podem executá-la.
create or replace function public.dmd_previsao_custo_salvar(
 p_revisao bigint,p_operacao_id uuid,p_dados jsonb,p_usuario text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
 atual jsonb; operacao jsonb; registro jsonb; revisao_atual bigint;
 solicitacao_hash text; instante timestamptz; em text;
begin
 if p_revisao is null or p_revisao<0 or p_revisao>=9007199254740991
    or p_operacao_id is null or p_usuario is null or length(btrim(p_usuario))=0 or length(p_usuario)>160
    or jsonb_typeof(p_dados) is distinct from 'object'
    or jsonb_typeof(p_dados->'settings') is distinct from 'object'
    or jsonb_typeof(p_dados->'contributionsReviewed') is distinct from 'boolean'
    or jsonb_typeof(p_dados->'contributions') is distinct from 'array'
    or jsonb_typeof(p_dados->'contracts') is distinct from 'object'
    or jsonb_typeof(p_dados->'receipts') is distinct from 'array'
    or octet_length(p_dados::text)>2097152 then
  raise exception 'PREVISAO_INVALIDA';
 end if;
 -- JSONB canoniza a ordem das propriedades. A revisão faz parte da operação;
 -- timestamps e ator vêm do servidor e nunca do conteúdo enviado pelo cliente.
 solicitacao_hash:=encode(sha256(convert_to(jsonb_build_object('revisao',p_revisao,'dados',p_dados)::text,'UTF8')),'hex');
 -- O lock transacional existe mesmo antes do primeiro registro. FOR UPDATE
 -- isolado não serializaria duas criações simultâneas de uma linha inexistente.
 perform pg_advisory_xact_lock(1145914448,1668641652);
 select valor into atual from public.dmd_kv where store='previsao_custo' and key='diamond' for update;
 select valor into operacao from public.dmd_kv where store='previsao_custo_operacoes' and key=p_operacao_id::text for update;
 if operacao is not null then
  if operacao->>'requestHash' is distinct from solicitacao_hash or operacao->>'actor' is distinct from p_usuario then
   raise exception 'PREVISAO_OPERACAO_CONFLITO';
  end if;
  if atual is null then raise exception 'PREVISAO_ESTADO_INVALIDO'; end if;
  -- Um retry após uma resposta perdida não cria nova revisão. Se outra pessoa
  -- já editou depois, devolvemos a versão corrente sem restaurar a antiga.
  return jsonb_build_object('registro',atual,'repetida',true);
 end if;
 if atual is not null and (atual->>'schema' is distinct from '1'
    or jsonb_typeof(atual->'revision') is distinct from 'number'
    or (atual->>'revision') !~ '^[0-9]+$') then raise exception 'PREVISAO_ESTADO_INVALIDO'; end if;
 revisao_atual:=coalesce((atual->>'revision')::bigint,0);
 if revisao_atual<>p_revisao then raise exception 'PREVISAO_CONFLITO'; end if;
 instante:=clock_timestamp();
 em:=to_char(instante at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 registro:=jsonb_build_object('schema',1,'revision',revisao_atual+1,'updatedAt',em,
   'updatedBy',p_usuario,'status','Salvo no sistema','data',p_dados);
 insert into public.dmd_kv(store,key,valor,atualizado_em) values('previsao_custo','diamond',registro,instante)
 on conflict(store,key) do update set valor=excluded.valor,atualizado_em=excluded.atualizado_em;
 insert into public.dmd_kv(store,key,valor,atualizado_em) values('previsao_custo_operacoes',p_operacao_id::text,
   jsonb_build_object('schema',1,'operationId',p_operacao_id::text,'requestHash',solicitacao_hash,'actor',p_usuario,'revision',revisao_atual+1,'createdAt',em),instante);
 return jsonb_build_object('registro',registro,'repetida',false);
end $$;
revoke all on function public.dmd_previsao_custo_salvar(bigint,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.dmd_previsao_custo_salvar(bigint,uuid,jsonb,text) to service_role;
