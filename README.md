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
- O período é compartilhável pela URL: `#p=7` ou
  `#ini=YYYY-MM-DD&fim=YYYY-MM-DD`.

Os dados brutos de campanhas não são modificados pelo frontend. As alterações
analíticas de banco ficam registradas em `supabase/migrations/`.

## Validação local

Com Node.js 22 ou superior:

```bash
npm test
npm run lint
```
