# DASHNAVE / DASHFULL

Dashboard público de performance diária das campanhas de mensagens, conectado ao
projeto Supabase `akffepitbqqqgldxvtlf`.

## Fonte oficial

`docs/index.html` é a única fonte da dashboard e a única pasta publicada pelo
GitHub Pages. O repositório não mantém uma segunda implementação em React,
Next ou Cloudflare Worker.

## Dados e disponibilidade

- O painel principal consulta `v_daily` filtrada exclusivamente por `typ=msgs`.
- KPIs, histórico, ROI e filtros continuam disponíveis mesmo se análises
  opcionais falharem.
- Ranking, fila de decisão e qualidade de dados são enriquecimentos progressivos
  dos RPCs `campaign_ranking`, `operational_alerts` e `data_quality_status`,
  cada um com timeout próprio.
- Os atalhos do período são de 3, 7 e 30 dias; intervalos personalizados são
  compartilháveis pela URL: `#p=7` ou `#ini=YYYY-MM-DD&fim=YYYY-MM-DD`.
- Toda campanha abre o mesmo demonstrativo, seja selecionada no histórico, na
  fila de decisão ou no ranking. O demonstrativo possui filtros próprios, gráfico
  diário e tabela por dia, sem alterar o filtro principal nem a posição de rolagem.
- Ao selecionar um dia no histórico mensal, a dashboard abre uma lista própria
  das campanhas daquele dia. Ela mostra gasto, custo total (Meta Ads + 13%),
  receita líquida (Gunn − 10%), lucro, ROI, status e comparativos; selecionar uma
  linha abre o demonstrativo detalhado da campanha sem fechar a lista do dia.

Os dados brutos de campanhas não são modificados pelo frontend. As alterações
analíticas de banco ficam registradas em `supabase/migrations/`.

## Validação local

Com Node.js 22 ou superior:

```bash
npm test
npm run lint
```
