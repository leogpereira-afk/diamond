# Previsão de custo — Diamond v60

Aba da gestão Diamond em `#/admin/painel?visao=previsao`. Os lançamentos, conferências e premissas pertencem ao empreendimento e ficam no banco do sistema. Computador e celular consultam o mesmo registro. A sincronização não modifica os contratos de venda existentes.

## Funcionamento

- Custo inicial configurável: R$ 17.000.000.
- A cobertura considera todos os contratos atuais do empreendimento, inclusive loja. Os filtros comerciais de outras abas não alteram a base da previsão.
- Cobertura = aportes realizados e conferidos + vendas brutas − comissão total das vendas − séries finais.
- Permutas já integram a venda bruta. Contam na cobertura, mas não são dinheiro recebido.
- Recebimentos comuns e finais têm baixas próprias. Eles decompõem a venda contratada e nunca são somados novamente à cobertura. Toda final permanece excluída, mesmo recebida.
- Falta = máximo de zero e custo menos cobertura. O excedente também aparece.
- Meta bruta de novas vendas = falta ÷ (participação durante a obra − comissão sobre a venda inteira), arredondada para cima no centavo. O padrão é 50% durante a obra e 50% final; a comissão futura precisa ser informada explicitamente, inclusive se zero.
- A seleção de unidades disponíveis usa o preço vigente, com reajustes/descontos aplicados pelo modelo existente. Reservas não entram na seleção nem são tratadas como vendas.
- Enquanto a aba está visível, as fontes são consultadas a cada 30 segundos; edições pendentes e diálogos pausam a atualização para preservar a digitação. Salvar retoma o ciclo. O botão Atualizar dados continua disponível.

## Conferência e persistência

O endpoint `previsaoCusto` de `dmd-api` aceita `carregar` e `salvar`, mediante autenticação da gestão (admin ou usuário domo). A tela identifica **Salvo no sistema** somente após resposta confirmada. Falta de conexão não é confirmação de gravação. Exportações incluem a última revisão confirmada; importar exige confirmação explícita de substituição do registro compartilhado.

Os stores `previsao_custo` e `previsao_custo_operacoes` são separados da configuração geral. A RPC `dmd_previsao_custo_salvar` é executável apenas por `service_role`, com `SECURITY INVOKER`. Um lock transacional serializa a primeira criação e as revisões seguintes. O identificador da operação, o hash do conteúdo e o ator permitem repetir uma tentativa cuja resposta se perdeu sem duplicar a gravação. Uma revisão desatualizada recebe HTTP 409; o usuário atualiza os dados mantendo o formulário antes de conferir e salvar novamente.

O navegador consulta os lançamentos ao abrir a aba, a cada 30 segundos enquanto estiver visível e ao voltar à janela ou recuperar a conexão. Edições pendentes e diálogos pausam o ciclo para preservar o formulário. A API continua bloqueando sobrescritas por revisões antigas.

A cópia v59 de cada navegador/usuário é preservada. No primeiro acesso, se o registro central estiver vazio, a transferência ocorre automaticamente. Se já existir conteúdo central, o botão de transferência só combina registros compatíveis, sem substituir configurações ou registros divergentes. A marca de migração só é gravada após confirmação do servidor. Conflitos permanecem visíveis e permitem exportar a cópia anterior para conferência.

Ausência de informação não equivale a zero: aportes, comissão e classificação de finais exigem conferência explícita. O mesmo vale para afirmar que nenhuma parcela foi recebida. Alterações do contrato invalidam a conferência antiga; baixas antigas ficam preservadas, fora dos totais, até revisão de vínculo. Mudar a classificação das finais desmarca a conferência de recebimentos.

Valores e cálculos são em centavos inteiros. Recibos e aportes com datas futuras não são aceitos como realizados. O painel é uma previsão de cobertura econômica da obra: não representa saldo bancário, cronograma mensal ou despesas já pagas.

## Estrutura

- `previsao-custo-domain.js`: cálculo puro e validações econômicas.
- `previsao-custo-schema.js`: validação compartilhada, também espelhada na função do servidor.
- `previsao-custo-store.js`: cliente autenticado, migração da cópia anterior, revisão, backup e importação.
- `supabase/functions/dmd-api/previsao-custo-api.mjs`: autorização, validação e chamada da RPC.
- `supabase/migrations/20261101215154_previsao_custo_sincronizada.sql`: gravação atômica e permissões.
- `previsao-custo.js` e `previsao-custo.css`: interação, conferências, indicadores e simulação.
- `gestao.js`, `gestao-painel.js`, `index.html`: integração com a navegação existente.

Não colocar este registro em `cfg`: a configuração geral é compartilhada por endpoints de outros perfis. A rotina privilegiada de backup inclui os dois novos stores. Os dados financeiros reais e os backups nunca devem entrar no repositório público.

## Verificação e prévia

Com Node disponível:

```sh
node --test tests/*.test.mjs tests/*.test.cjs tests-vagas.cjs
node tests/serve-previsao-preview.mjs
```

A prévia usa API sintética em memória e fica em `http://127.0.0.1:8794/#/admin/painel?visao=previsao`. Não consulta nem altera o sistema real. Os dados financeiros manuais iniciam a conferir; o custo de 17 milhões é apenas a configuração solicitada.

A auditoria de navegador em `tests/audit-previsao-ui.mjs` usa Playwright e Chrome, gera evidências em `output-previsao` e um servidor sintético próprio. `PLAYWRIGHT_MODULE`, `CHROME_PATH` e `PREVIEW_PORT` permitem adaptar os caminhos ao ambiente.

`tests/audit-previsao-sync-ui.mjs` verifica contextos separados de computador/celular, conflitos, falhas de rede, repetição de gravação e migração. `tests/previsao-sync-postgres.mjs` verifica a RPC em PostgreSQL isolado, incluindo concorrência, permissões e rollback; suas dependências ficam fora do repositório em `DIAMOND_PG_DEPS`.

## Publicação

Aplicar a migração e publicar `dmd-api` antes da interface v60. A função mantém `verify_jwt=false` porque usa a autenticação própria já existente; isso não libera o endpoint financeiro. Conferir permissões, comportamento sem autenticação, testes e arquivos efetivamente servidos. Publicar GitHub Pages não publica a função do servidor.
