# DASHNAVE / DASHFULL

Dashboard público de performance diária das campanhas de mensagens, conectado ao
projeto Supabase `akffepitbqqqgldxvtlf`.

## Fonte oficial

`docs/index.html` é a única fonte da dashboard e a única pasta publicada pelo
GitHub Pages. O repositório não mantém uma segunda implementação em React,
Next ou Cloudflare Worker.

## Dados e disponibilidade

- O painel principal consulta `v_daily` filtrada exclusivamente por `typ=msgs`.
  As linhas são paginadas e o histórico mensal e de campanha é carregado sob
  demanda e mantido em cache durante a sessão, reduzindo o tempo de abertura.
- KPIs, histórico, ROI e filtros continuam disponíveis mesmo se análises
  opcionais falharem.
- Ranking, fila de decisão e qualidade de dados são enriquecimentos progressivos
  dos RPCs `campaign_ranking`, `operational_alerts` e `data_quality_status`,
  cada um com timeout próprio.
- Os atalhos do período são de 3, 7 e 30 dias; intervalos personalizados são
  compartilháveis pela URL: `#p=7` ou `#ini=YYYY-MM-DD&fim=YYYY-MM-DD`.
- A coluna histórica lista apenas os meses. Selecionar um mês abre o resumo
  financeiro de cada dia; selecionar o dia abre suas campanhas; selecionar uma
  campanha abre seu demonstrativo completo.
- O total mensal representa o intervalo entre a primeira e a última data
  importada. Lacunas são mostradas separadamente como dias ainda sem dados,
  evitando confundir o dia mais recente do mês com a quantidade de arquivos
  efetivamente recebidos.
- Esse fluxo usa um único pop-up com navegação interna de retorno. O `X` fecha
  todo o fluxo, enquanto a seta volta ao nível anterior preservando a posição
  da tabela.
- Todas as colunas das tabelas são ordenáveis. O demonstrativo da campanha
  possui filtros próprios, gráfico diário e tabela por dia, sem alterar o filtro
  principal nem a posição de rolagem.
- Gasto, custo total (Meta Ads + 13%), receita bruta do GAM, receita líquida
  (GAM − 10%), lucro e ROI são exibidos separadamente.
- Quando existe receita com custo zerado, o ROI é representado por `∞`. Se um
  dia inteiro tiver receita e nenhum gasto registrado, o painel também alerta
  que o arquivo do Meta Ads precisa ser conferido antes de interpretar o retorno.

Os dados brutos de campanhas não são modificados pelo frontend. As alterações
analíticas de banco ficam registradas em `supabase/migrations/`.

## Validação local

Com Node.js 22 ou superior:

```bash
npm test
npm run lint
```
