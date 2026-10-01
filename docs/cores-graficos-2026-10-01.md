# Cores e gráficos da gestão Diamond

Pedido: mais cor nas tabelas e gráficos para leitura gerencial, preservando a identidade Diamond.

## Entrega

- Quatro gráficos na visão geral: estoque por situação, propostas dos seis meses até hoje, carteira por etapa e prazos das reservas.
- Barras de estoque, CRM e reservas abrem as listas com o filtro correspondente. Trocar ou limpar a etapa do cadastro atualiza a URL.
- Estoque: verde disponível, violeta reservado, vermelho vendido. Alertas de prazo ausente em âmbar. Atrasos em vermelho. Etapas CRM recebem badges com texto e fundos suaves.
- Clientes, vendas, reservas, envios e compradores recebem reforço visual. Registros de envio sem acompanhamento permanecem neutros, não viram pendentes por inferência.
- Relatório gerencial inclui os gráficos de estoque e de propostas, com impressão em paisagem.

## Regras dos dados

- Propostas são contadas por emissão, não representam receita nem conversão em venda. O mês atual é parcial e usa o dia de Brasília.
- Fontes indisponíveis não viram zeros. Propostas com consulta parcial carregam aviso. Datas inválidas e futuras são informadas como exclusões. Meses sem propostas permanecem na série.
- Etapas desconhecidas e situações adicionais são contadas separadamente, mantendo os totais reconciliáveis.
- Reservas vencidas, sem prazo e vigentes são separadas; pedidos de reserva são outra fila.
- Cores reforçam os rótulos, que permanecem visíveis. Nenhuma alteração no backend ou nos registros de produção.

## Verificação

- Testes de agregação: meses zerados, virada de ano, São Paulo, datas inválidas/futuras, categorias desconhecidas, falha e leitura parcial.
- Navegação real na prévia local: clique do gráfico até o cadastro, troca e limpeza de etapa.
- Inspeção visual no computador e celular de 390 px.
- Suíte final: 124 testes aprovados; sintaxe e whitespace conferidos.
- PDF gerado no navegador com dados fictícios: 2 páginas A4 em paisagem, com os gráficos e tabelas legíveis.

- Verificação pública identificou e corrigiu a lista de propostas recentes, que agora usa a ordem decrescente de emissão também no relatório. Regressão cobre a consulta recebida em ordem crescente.
