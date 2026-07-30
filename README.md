# DASHFULL

Dashboard público de performance diária conectado ao projeto Supabase
`akffepitbqqqgldxvtlf`.

## O que exibe

- gasto, receita líquida, custo, lucro e ROI;
- alertas priorizados por impacto;
- evolução consolidada por dia;
- ranking e busca de campanhas;
- detalhe diário de cada campanha;
- indicação de dados parciais.

Os dados são lidos diretamente do Supabase. As atualizações diárias devem ser
registradas na base antes de aparecerem no painel.

## Publicação

A pasta `docs/` é a versão estática destinada ao GitHub Pages. Ela consulta os
mesmos dados públicos do Supabase e é mantida junto ao código da dashboard.
