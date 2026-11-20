# Plantas de 1 e 2 quartos nas propostas

Nas propostas do corretor, do simulador administrativo e da SCP, cada apartamento oferece as opções **1 quarto** e **2 quartos**. A loja não recebe essa escolha.

- 1 quarto mantém o preço vigente da proposta.
- 2 quartos soma R$ 15.000 ao valor já negociado, depois dos descontos, e recalcula o pagamento e a comissão.
- A proposta guarda a escolha, o adicional, o preço sem o adicional e a referência da planta. Reabrir não soma o adicional novamente. Registros anteriores continuam como 1 quarto e preservam seu preço.
- PDFs e resumos compartilhados identificam a escolha e o acréscimo. PDFs já arquivados permanecem intactos.

As imagens existentes continuam em `cfg.fotosTipo`. As plantas de 2 quartos usam `cfg.fotosTipo2Quartos`, também por final de unidade. O administrador pode selecionar 2 quartos no simulador e usar o botão de planta, ou acessar Preços e unidades > Fotos por tipo de planta. A imagem vale para todas as unidades daquele final e daquela opção.

Os PNGs originais dos finais 01, 03, 04, 05, 06, 07 e 08 acompanham o site e aparecem automaticamente na opção de dois quartos. Uma imagem cadastrada pelo administrador para aquele final tem prioridade. O final 02 depende de cadastro.

Enquanto a planta de 2 quartos não estiver cadastrada, a tela e o PDF indicam **Planta de 2 quartos a cadastrar**. A imagem de 1 quarto não é usada para representar 2 quartos.

Durante a emissão do corretor, a escolha fica bloqueada até terminar. A SCP captura as condições no clique para que PDF, registro e mensagem usem a mesma escolha mesmo se a tela for alterada durante o carregamento.

## Verificação

Testes de domínio, persistência de fotos, reabertura, troca de tabela, PDFs e emissão assíncrona cobrem a regra. Conferência no Chrome em 390 e 1360 px cobre os botões, parcelas, PDF, cadastro separado de imagens e reabertura administrativa. Dados de teste são fictícios e o transporte da prévia é restrito ao servidor local.

Não requer migração de dados nem alteração da API. Publicação da interface com cache v82.
