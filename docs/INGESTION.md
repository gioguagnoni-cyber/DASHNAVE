# Lançamento diário multi-conta

O importador prepara uma carga atômica e auditável; ele não possui credencial administrativa e não grava diretamente no Supabase.

## Fontes aceitas

1. Relatório GAM em CSV + relatório Meta Ads em CSV.
2. Relatório GAM em CSV + snapshot JSON obtido pelo conector Meta Ads.

O snapshot JSON usa este formato:

```json
{
  "account_id": "2948780535467215",
  "account_name": "DIZZ 1 USD",
  "currency": "USD",
  "reporting_date": "2026-08-19",
  "account_total_spend": 14.36,
  "campaigns": [
    {
      "id": "120252469693900652",
      "name": "01-RELAC-ES-URUGUAI-66830",
      "effective_status": "ACTIVE",
      "objective": "OUTCOME_SALES",
      "spend": 10.76,
      "impressions": 5233
    }
  ]
}
```

## Preparação

```bash
node scripts/prepare-daily-import.mjs \
  --gam "/caminho/relatorio-gam.csv" \
  --meta-snapshot "/caminho/meta-snapshot.json" \
  --account-id 2948780535467215 \
  --date 2026-08-19 \
  --badge final \
  --out-dir "/caminho/saida"
```

Para CSV do Meta, substitua `--meta-snapshot` por `--meta` e, se necessário, informe `--meta-currency USD`.

## Travas

- conta identificada pelo ID, nunca apenas pelo nome;
- moeda do GAM e do Meta igual à moeda cadastrada da conta;
- data do snapshot igual à data do lançamento;
- campanha de mensagens cadastrada ou variação explícita do mesmo titular;
- gasto nunca atribuído a campanha inativa;
- receita residual vinculada somente à última campanha ativa do mesmo sufixo e da mesma conta;
- divergência superior a 1 unidade monetária entre total da conta e soma das campanhas bloqueia a carga;
- custo e receita calculados com as taxas da conta;
- SQL transacional, idempotente por conta+data e acompanhado por hashes dos arquivos.

## Aplicação

Antes de aplicar `atomic-import.sql`, revise `audit-summary.json`. A aplicação deve ser feita por uma conexão administrativa ou pelo conector Supabase. Em seguida, compare os totais da view `v_daily` com o resumo e execute os advisors de segurança e desempenho.
