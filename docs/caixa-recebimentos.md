# Caixa mensal e confirmações de recebimento

O Painel → Caixa expande as condições das unidades vendidas em parcelas por vencimento. O usuário escolhe o mês, busca cliente/unidade e confirma o recebimento integral ou parcial, informando a data real. Os saldos só mudam após confirmação do servidor.

## Critérios

- Valores monetários são centavos inteiros; o mesmo domínio é usado pelo navegador e pela API.
- Previsto, recebido das parcelas e a receber seguem os vencimentos e os filtros exibidos. Entrou no caixa segue a data efetiva dos recebimentos e a busca, independentemente do filtro de situação das parcelas.
- Permutas não são dinheiro. Entradas sem vencimento cadastrado aparecem em “Sem vencimento”; a data da venda não vira vencimento por inferência.
- Valores são nominais: índices futuros, juros e INCC não são estimados automaticamente.
- Falha de consulta é “A conferir”. Vendas sem condições, compradores ausentes e composições incompletas aparecem na cobertura; não se inventam parcelas.
- A expressão “Vencida sem confirmação” indica ausência de baixa registrada, não comprova inadimplência.
- A Previsão de custo v60 já sincroniza recebimentos gerais do empreendimento. Eles permanecem separados das confirmações por parcela deste caixa; não são importados nem somados automaticamente. Antes de confirmar aqui, confira os valores já registrados na Previsão de custo para não repetir um recebimento.

## Relação com a Previsão de custo v60

A fonte `previsao_custo` usa registros de recebimento com `unitId`, `contractKey`, `data`, `valorCents` e `natureza` (`comum` ou `final`). Esses campos não identificam a parcela nem seu vencimento individual. Uma entrada geral pode abranger várias parcelas; data e valor semelhantes não comprovam o mesmo vínculo.

O Caixa usa `vendas_recebimentos`, com `parcelaId` e `cronogramaChave`, para calcular baixas e saldos por vencimento. A sincronização da v60 não altera esse contrato da API. Os indicadores do Caixa consideram apenas suas confirmações por parcela; os recebimentos gerais já existentes não são redistribuídos silenciosamente nem são somados aos dois módulos. Uma conciliação futura precisa apresentar os registros gerais, confirmar os vínculos e rastrear a origem antes de qualquer transferência.

## Persistência e integridade

`caixaRecebimentos` oferece `listar`, `confirmar` e `estornar`. O acesso exige administrador ou autenticação master da Domo. A store `vendas_recebimentos` mantém um ledger por unidade com revisão e eventos append-only; foi incluída no backup.

Confirmações têm identificador idempotente e snapshot de origem. A API reexpande a parcela, valida saldo/data e usa a RPC `dmd_caixa_recebimento_salvar` para conferir simultaneamente unidade, comprador, condições e revisão do ledger. Conflitos não sobrescrevem dados. Reenvio da mesma operação não duplica caixa.

Estorno acrescenta evento com motivo e autor; não remove a confirmação original. Pode corrigir uma confirmação mesmo após reabertura ou remoção da unidade. Mudanças financeiras no cronograma deixam baixas anteriores para conferência; essas baixas continuam no histórico e no caixa real, sem serem aplicadas automaticamente a outro plano.

## Prévia e verificação

```sh
node tests/serve-caixa-preview.mjs
# http://127.0.0.1:8796/#/admin/painel?visao=caixa&mes=2026-10

node --test tests/*.test.mjs tests/*.test.cjs verificar-copias.cjs verificar-versoes.cjs tests-vagas.cjs
node tests/caixa-recebimentos-sql.mjs /caminho/local/pglite/dist/index.js
node tests/caixa-recebimentos-concorrencia.mjs /caminho/local/embedded-postgres/dist/index.js
```

A prévia usa somente dados fictícios e API em memória. Recarregar o navegador preserva seus registros enquanto o servidor local estiver ligado; reiniciá-lo restaura a fixture. Isso não substitui a conferência da publicação no servidor real.

## Publicação

Preparado como candidato v61, ainda sujeito à aprovação de publicação. Aplicar a migração `20261101230000_caixa_recebimentos.sql` e publicar a função `dmd-api` com o domínio espelhado antes do frontend. A função usa RPC interna sem acesso `anon`/`authenticated`; o ledger não deve ganhar API de escrita genérica.

Antes de publicar: atualizar a main, conferir mudanças concorrentes, guardar cópia privada da função/dados e repetir testes. Após publicar: conferir assets versionados e a consulta autenticada. Nenhum recebimento real deve ser confirmado só para validar a implantação. Um rollback visual conserva os ledgers e seu histórico.
