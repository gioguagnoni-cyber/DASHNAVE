"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SUPABASE_URL = "https://akffepitbqqqgldxvtlf.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_yEPQth9v7-mNr0tPavuQyw_yv9IkJbk";
const QUICK_RANGES = [3, 5, 7, 14, 30];
const DAILY_FIELDS = "di,date,campaign_id,label,spend,cost,rev_adj,profit,roi,novos,rpm,status";

type Day = { di: number; date: string; label: string; badge?: string | null };
type Summary = {
  portfolio?: { spend?: number; cost?: number; rev_adj?: number; profit?: number; roi?: number };
  operacional?: { campanhas?: number };
  residual?: { campanhas?: number };
};
type Alert = { tipo: string; prioridade: number; campaign_id: number; label: string; impacto: number; detalhe: string };
type RankingRow = { campaign_id: number; label: string; suffix?: string; niche?: string; spend?: number; cost?: number; rev_adj?: number; profit?: number; roi?: number; tendencia?: string; confianca?: string; recomendacao?: string };
type DailyRow = { di: number; date: string; campaign_id: number; label: string; spend?: number; cost?: number; rev_adj?: number; profit?: number; roi?: number; novos?: number; rpm?: number; status?: string };
type Quality = { dias_parciais?: string[] };
type LoadedData = { summary: Summary; alerts: Alert[]; ranking: RankingRow[]; daily: DailyRow[]; quality: Quality };
type DrawerState = { campaign: RankingRow; rows: DailyRow[]; scopeLabel: string };
type RoiWindow = { roi: number | null; coverage: number; requested: number };

function numeric(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function money(value: unknown) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(numeric(value)); }
function preciseMoney(value: unknown) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric(value)); }
function percent(value: unknown) { const number = numeric(value); return `${number > 0 ? "+" : ""}${number.toFixed(1)}%`; }
function shortDate(value?: string) { if (!value) return "—"; const [year, month, day] = value.split("-"); return `${day}/${month}/${year.slice(2)}`; }
function classForValue(value: unknown) { const number = numeric(value); return number > 0 ? "positive" : number < 0 ? "negative" : ""; }
function campaignKey(row: DailyRow) { return `${row.di}:${row.campaign_id}`; }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error("Os dados não puderam ser carregados agora.");
  return response.json() as Promise<T>;
}

function rpc<T>(name: string, body: Record<string, unknown>) { return request<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) }); }

function useKnownDays() {
  const [days, setDays] = useState<Day[]>([]);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    setError(false);
    try { setDays(await request<Day[]>("days?select=di,date,label,badge&order=di.asc")); }
    catch { setError(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { days, error, reload };
}

function useFullHistory() {
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true); setError(false);
    try { setRows(await request<DailyRow[]>(`v_daily?typ=eq.msgs&select=${DAILY_FIELDS}&order=di.asc`)); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { rows, loading, error, reload };
}

function totalRows(rows: DailyRow[]) {
  return rows.reduce((all, row) => ({ spend: all.spend + numeric(row.spend), cost: all.cost + numeric(row.cost), revenue: all.revenue + numeric(row.rev_adj), profit: all.profit + numeric(row.profit) }), { spend: 0, cost: 0, revenue: 0, profit: 0 });
}

function roiWindow(rows: DailyRow[], selectedDi: number, requested: number): RoiWindow | null {
  const inWindow = rows.filter((row) => row.di <= selectedDi && row.di >= selectedDi - requested + 1);
  const totals = totalRows(inWindow);
  if (!inWindow.length) return null;
  return { roi: totals.cost ? totals.profit / totals.cost * 100 : null, coverage: new Set(inWindow.map((row) => row.di)).size, requested };
}

function aggregateDaily(rows: DailyRow[]) {
  const values = new Map<number, { di: number; date: string; spend: number; rev: number; profit: number }>();
  rows.forEach((row) => {
    const item = values.get(row.di) ?? { di: row.di, date: row.date, spend: 0, rev: 0, profit: 0 };
    item.spend += numeric(row.spend); item.rev += numeric(row.rev_adj); item.profit += numeric(row.profit); values.set(row.di, item);
  });
  return [...values.values()].sort((a, b) => a.di - b.di);
}

function EvolutionChart({ rows }: { rows: DailyRow[] }) {
  const points = aggregateDaily(rows);
  if (!points.length) return <div className="chart-empty">Não há resultado diário neste período.</div>;
  const width = 740, height = 250, pad = { top: 14, right: 16, bottom: 30, left: 16 };
  const innerWidth = width - pad.left - pad.right, innerHeight = height - pad.top - pad.bottom;
  const maxRevenue = Math.max(...points.flatMap((item) => [item.spend, item.rev]), 1);
  const minProfit = Math.min(0, ...points.map((item) => item.profit));
  const maxProfit = Math.max(0, ...points.map((item) => item.profit));
  const profitSpan = maxProfit - minProfit || 1;
  const x = (index: number) => pad.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const yBar = (value: number) => pad.top + innerHeight - (value / maxRevenue) * innerHeight;
  const yProfit = (value: number) => pad.top + innerHeight - ((value - minProfit) / profitSpan) * innerHeight;
  const barWidth = Math.max(5, Math.min(15, (innerWidth / points.length) * .31));
  const profitPoints = points.map((point, index) => `${x(index)},${yProfit(point.profit)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  return <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolução diária de gasto, receita e lucro">
    <line x1={pad.left} x2={width - pad.right} y1={yProfit(0)} y2={yProfit(0)} stroke="#dfe5ed" strokeDasharray="3 4" />
    {points.map((point, index) => <g key={point.di}>
      <rect x={x(index) - barWidth - 1} y={yBar(point.spend)} width={barWidth} height={Math.max(0, pad.top + innerHeight - yBar(point.spend))} fill="#bfd0f7" rx="2" />
      <rect x={x(index) + 1} y={yBar(point.rev)} width={barWidth} height={Math.max(0, pad.top + innerHeight - yBar(point.rev))} fill="#84ceb4" rx="2" />
      {(index % labelEvery === 0 || index === points.length - 1) && <text className="chart-axis" x={x(index)} y={height - 8} textAnchor="middle">{shortDate(point.date).slice(0, 5)}</text>}
    </g>)}
    <polyline fill="none" points={profitPoints} stroke="#2259d6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    {points.map((point, index) => <circle key={`point-${point.di}`} cx={x(index)} cy={yProfit(point.profit)} r="2.8" fill="#2259d6" />)}
  </svg>;
}

function MetricCard({ label, value, foot, tone = "" }: { label: string; value: string; foot: string; tone?: string }) {
  return <article className={`metric-card ${tone}`}><div className="metric-label">{label}</div><div className={`metric-value ${tone === "red" ? "negative" : tone === "green" ? "positive" : ""}`}>{value}</div><div className="metric-foot">{foot}</div></article>;
}

function RoiComparison({ label, value }: { label: string; value: RoiWindow | null }) {
  const result = !value ? "Não rodou" : value.roi === null ? "Sem custo" : percent(value.roi);
  return <div className="roi-comparison"><span>{label}</span><strong className={classForValue(value?.roi)}>{result}</strong>{value && value.coverage < value.requested && <small>{value.coverage}/{value.requested} dias com dados</small>}</div>;
}

function HistoryCampaignDetails({ row, historyRows, onOpenHistory }: { row: DailyRow; historyRows: DailyRow[]; onOpenHistory: (row: DailyRow) => void }) {
  const campaignRows = historyRows.filter((item) => item.campaign_id === row.campaign_id).sort((a, b) => a.di - b.di);
  return <div className="history-campaign-details">
    <div className="history-metrics" aria-label={`Indicadores de ${row.label} em ${shortDate(row.date)}`}>
      <div><span>Gasto</span><strong>{preciseMoney(row.spend)}</strong></div><div><span>Receita</span><strong>{preciseMoney(row.rev_adj)}</strong></div>
      <div><span>Lucro</span><strong className={classForValue(row.profit)}>{preciseMoney(row.profit)}</strong></div><div><span>ROI</span><strong className={classForValue(row.roi)}>{percent(row.roi)}</strong></div>
      <div className="history-status"><span>Status</span><strong><i className={`status-dot ${row.status ?? "sem-status"}`} />{row.status ?? "sem status"}</strong></div>
    </div>
    <div className="roi-comparisons" aria-label="Comparativo de ROI">
      <RoiComparison label="Dia" value={roiWindow(campaignRows, row.di, 1)} />
      <RoiComparison label="Ontem" value={roiWindow(campaignRows, row.di - 1, 1)} />
      <RoiComparison label="D-2" value={roiWindow(campaignRows, row.di - 2, 1)} />
      <RoiComparison label="Últimos 7" value={roiWindow(campaignRows, row.di, 7)} />
      <RoiComparison label="Últimos 14" value={roiWindow(campaignRows, row.di, 14)} />
    </div>
    <div className="sidebar-history-block"><div className="sidebar-history-title"><span>Histórico completo</span><b>{campaignRows.length} dias</b></div><div className="sidebar-history-list">{campaignRows.map((item) => <div key={`${item.di}-${item.campaign_id}`}><span>{shortDate(item.date)}</span><span>{preciseMoney(item.spend)}</span><strong className={classForValue(item.roi)}>{percent(item.roi)}</strong><em>{item.status ?? "sem status"}</em></div>)}</div></div>
    <button className="open-history-button" onClick={() => onOpenHistory(row)}>Abrir tabela completa</button>
  </div>;
}

function DailyHistorySidebar({ days, historyRows, loading, error, expandedDay, expandedCampaign, onDayToggle, onCampaignToggle, onOpenHistory, onRetry }: { days: Day[]; historyRows: DailyRow[]; loading: boolean; error: boolean; expandedDay: number | null; expandedCampaign: string | null; onDayToggle: (di: number) => void; onCampaignToggle: (row: DailyRow) => void; onOpenHistory: (row: DailyRow) => void; onRetry: () => void }) {
  return <aside className="history-sidebar" aria-label="Histórico diário de campanhas"><div className="history-sidebar-head"><div><p className="eyebrow">HISTÓRICO COMPLETO</p><h2>Campanhas por dia</h2><p>Expanda uma campanha para comparar seu ROI.</p></div><span>{historyRows.length ? `${days.length} dias` : "…"}</span></div>{loading ? <div className="history-loading">Carregando o histórico diário…</div> : error ? <div className="history-error"><p>O histórico não pôde ser carregado.</p><button onClick={onRetry}>Tentar novamente</button></div> : <div className="history-days">{[...days].reverse().map((day) => {
    const campaigns = historyRows.filter((row) => row.di === day.di).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    const open = expandedDay === day.di;
    return <section className="history-day" key={day.di}><button className="history-day-button" aria-expanded={open} onClick={() => onDayToggle(day.di)}><span><b>{`Dia ${day.di + 1}`}</b><small>{shortDate(day.date)}</small></span><span>{campaigns.length} campanhas <i>{open ? "−" : "+"}</i></span></button>{open && <div className="history-campaigns">{campaigns.length ? campaigns.map((row) => { const openCampaign = expandedCampaign === campaignKey(row); return <div className="history-campaign" key={campaignKey(row)}><button className="history-campaign-button" aria-expanded={openCampaign} onClick={() => onCampaignToggle(row)}><span>{row.label}</span><strong className={classForValue(row.roi)}>{percent(row.roi)}</strong><i>{openCampaign ? "−" : "+"}</i></button>{openCampaign && <HistoryCampaignDetails row={row} historyRows={historyRows} onOpenHistory={onOpenHistory} />}</div>; }) : <div className="history-empty">Nenhuma campanha neste dia.</div>}</div>}</section>;
  })}</div>}</aside>;
}

function CampaignDrawer({ campaign, daily, scopeLabel, onClose }: { campaign: RankingRow; daily: DailyRow[]; scopeLabel: string; onClose: () => void }) {
  const rows = daily.filter((row) => row.campaign_id === campaign.campaign_id).sort((a, b) => a.di - b.di);
  const total = totalRows(rows);
  const roi = total.cost ? total.profit / total.cost * 100 : 0;
  return <><button className="drawer-backdrop" aria-label="Fechar detalhes" onClick={onClose} /><aside className="drawer" aria-label="Detalhe da campanha">
    <button className="drawer-close" aria-label="Fechar" onClick={onClose}>×</button>
    <p className="eyebrow">{scopeLabel}</p><h2>{campaign.label}</h2><p className="drawer-subtitle">{campaign.niche ? `Nicho: ${campaign.niche} · ` : ""}{rows.length} dias com resultado</p>
    <div className="drawer-metrics"><div className="drawer-metric"><span>Gasto</span><strong>{money(total.spend)}</strong></div><div className="drawer-metric"><span>Receita líquida</span><strong>{money(total.revenue)}</strong></div><div className="drawer-metric"><span>Lucro</span><strong className={classForValue(total.profit)}>{money(total.profit)}</strong></div><div className="drawer-metric"><span>ROI</span><strong className={classForValue(roi)}>{percent(roi)}</strong></div></div>
    <h3 className="panel-title">Dia a dia</h3><div className="table-scroller"><table className="drawer-table"><thead><tr><th>Data</th><th>Gasto</th><th>Rec. líq.</th><th>Lucro</th><th>ROI</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.di}-${row.campaign_id}`}><td>{shortDate(row.date)}</td><td>{preciseMoney(row.spend)}</td><td>{preciseMoney(row.rev_adj)}</td><td className={classForValue(row.profit)}>{preciseMoney(row.profit)}</td><td className={classForValue(row.roi)}>{percent(row.roi)}</td><td><span className="drawer-status"><i className={`status-dot ${row.status ?? "sem-status"}`} />{row.status ?? "sem status"}</span></td></tr>)}</tbody></table></div>
  </aside></>;
}

export function DashboardClient() {
  const { days, error: daysError, reload: reloadDays } = useKnownDays();
  const history = useFullHistory();
  const [quickRange, setQuickRange] = useState(7);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const latestDashboardRequest = useRef(0);

  const activeDays = useMemo(() => {
    const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
    if (customStart && customEnd) return ordered.filter((day) => day.date >= customStart && day.date <= customEnd);
    return ordered.slice(-quickRange);
  }, [days, quickRange, customStart, customEnd]);
  const rangeStart = activeDays[0]?.di;
  const rangeEnd = activeDays.at(-1)?.di;
  const rangeKey = `${rangeStart ?? ""}:${rangeEnd ?? ""}`;

  useEffect(() => { setExpandedDay((current) => current ?? days.at(-1)?.di ?? null); }, [days]);

  const loadDashboard = useCallback(async () => {
    if (rangeStart === undefined || rangeEnd === undefined) return;
    const requestId = ++latestDashboardRequest.current;
    setLoading(true); setError(false); setData(null);
    try {
      const [summary, ranking, alerts, quality, daily] = await Promise.all([
        rpc<Summary>("dashboard_summary", { di_ini: rangeStart, di_fim: rangeEnd }),
        rpc<RankingRow[]>("campaign_ranking", { di_ini: rangeStart, di_fim: rangeEnd, min_spend: 150, roi_meta: 20, exclude_prefix: null }),
        rpc<Alert[]>("operational_alerts", { di_ini: rangeStart, di_fim: rangeEnd, min_spend: 150, roi_meta: 20 }),
        rpc<Quality>("data_quality_status", { di_ini: rangeStart, di_fim: rangeEnd }),
        request<DailyRow[]>(`v_daily?typ=eq.msgs&di=gte.${rangeStart}&di=lte.${rangeEnd}&select=${DAILY_FIELDS}`),
      ]);
      if (requestId === latestDashboardRequest.current) setData({ summary, ranking, alerts, quality, daily });
    } catch { if (requestId === latestDashboardRequest.current) setError(true); } finally { if (requestId === latestDashboardRequest.current) setLoading(false); }
  }, [rangeStart, rangeEnd]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard, rangeKey]);

  const filteredRanking = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    if (!query) return data?.ranking ?? [];
    return (data?.ranking ?? []).filter((row) => `${row.label} ${row.suffix ?? ""} ${row.niche ?? ""}`.toLocaleLowerCase("pt-BR").includes(query));
  }, [data?.ranking, search]);

  const totals = useMemo(() => totalRows(data?.daily ?? []), [data?.daily]);
  const portfolio = data?.summary.portfolio;
  const metrics = portfolio ? { spend: numeric(portfolio.spend), cost: numeric(portfolio.cost), revenue: numeric(portfolio.rev_adj), profit: numeric(portfolio.profit), roi: numeric(portfolio.roi) } : { spend: totals.spend, cost: totals.cost, revenue: totals.revenue, profit: totals.profit, roi: totals.cost ? totals.profit / totals.cost * 100 : 0 };
  const campaignCount = numeric(data?.summary.operacional?.campanhas) + numeric(data?.summary.residual?.campanhas) || new Set(data?.daily.map((row) => row.campaign_id)).size;
  const rangeText = activeDays.length ? `${shortDate(activeDays[0].date)} → ${shortDate(activeDays.at(-1)?.date)}` : "Sem data disponível";
  const partialDays = data?.quality.dias_parciais ?? [];

  const applyQuickRange = (value: number) => { setQuickRange(value); setCustomStart(""); setCustomEnd(""); };
  const retry = () => { void reloadDays(); void loadDashboard(); void history.reload(); };
  const openPeriodDrawer = (campaign: RankingRow) => setDrawer({ campaign, rows: data?.daily ?? [], scopeLabel: "Período selecionado" });
  const openHistoryDrawer = (row: DailyRow) => setDrawer({ campaign: { campaign_id: row.campaign_id, label: row.label }, rows: history.rows, scopeLabel: "Histórico completo" });

  if (daysError) return <main className="dashboard-shell"><div className="dashboard-wrap error-page"><div className="error-card"><h2>Não foi possível iniciar o painel</h2><p>Verifique a conexão com a base de dados e tente novamente.</p><button className="retry-button" onClick={retry}>Tentar novamente</button></div></div></main>;
  if (!days.length) return <main className="dashboard-shell"><div className="dashboard-wrap loading-page"><div className="loading-card"><div className="loading-pulse" /><p>Preparando os dados da DASHFULL…</p></div></div></main>;

  return <main className="dashboard-shell"><div className="dashboard-wrap">
    <header className="topbar"><div className="brand-lockup"><div className="brand-mark">Df</div><div><p className="eyebrow">DIZZ 1 WAVE</p><h1>DASHFULL</h1><p className="subtitle">Performance diária, com decisões claras.</p></div></div><span className="public-badge">Painel público</span></header>
    <section className="filter-panel" aria-label="Filtros de período"><span className="filter-label">Período do painel</span><div className="quick-ranges">{QUICK_RANGES.map((value) => <button key={value} className={!customStart && quickRange === value ? "active" : ""} onClick={() => applyQuickRange(value)}>{value} dias</button>)}</div><div className="date-fields"><label>De <input type="date" min={days[0]?.date} max={days.at(-1)?.date} value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label>Até <input type="date" min={days[0]?.date} max={days.at(-1)?.date} value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></div></section>
    <div className="dashboard-body"><DailyHistorySidebar days={days} historyRows={history.rows} loading={history.loading} error={history.error} expandedDay={expandedDay} expandedCampaign={expandedCampaign} onDayToggle={(di) => { setExpandedDay((current) => current === di ? null : di); setExpandedCampaign(null); }} onCampaignToggle={(row) => setExpandedCampaign((current) => current === campaignKey(row) ? null : campaignKey(row))} onOpenHistory={openHistoryDrawer} onRetry={() => void history.reload()} />
      <div className="dashboard-main"><p className="range-context"><strong>{rangeText}</strong><span className="separator">•</span><span>{activeDays.length} {activeDays.length === 1 ? "dia com dados" : "dias com dados"}</span>{loading && <><span className="separator">•</span><span>Atualizando…</span></>}</p>
      {loading && !data ? <section className="period-loading"><div className="loading-pulse" /><p>Atualizando o período selecionado…</p></section> : error ? <section className="error-card"><h2>Os dados não puderam ser atualizados</h2><p>Verifique a conexão com a base de dados e tente novamente.</p><button className="retry-button" onClick={() => void loadDashboard()}>Atualizar agora</button></section> : <>
        {partialDays.length > 0 && <div className="quality-banner"><span>⚠</span><span><b>Dados parciais:</b> {partialDays.join(", ")}. Decisões deste período merecem conferência adicional.</span></div>}
        <section className="metric-grid" aria-label="Resumo do período"><MetricCard label="Gasto total" value={money(metrics.spend)} foot={`${campaignCount} campanhas com resultado`} /><MetricCard label="Receita líquida" value={money(metrics.revenue)} foot="Após os ajustes de receita aplicados" tone="green" /><MetricCard label="Lucro" value={money(metrics.profit)} foot={`Custo total: ${money(metrics.cost)}`} tone={metrics.profit < 0 ? "red" : "green"} /><MetricCard label="ROI" value={percent(metrics.roi)} foot="Retorno sobre o custo total" tone={metrics.roi < 0 ? "red" : "green"} /></section>
        <section className="content-grid"><article className="panel"><div className="panel-head"><div><h2 className="panel-title">Evolução diária</h2><p className="panel-description">Gasto e receita em barras; lucro em linha.</p></div><div className="legend"><span><i style={{ background: "#bfd0f7" }} />Gasto</span><span><i style={{ background: "#84ceb4" }} />Receita</span><span><i style={{ background: "#2259d6" }} />Lucro</span></div></div><div className="chart-area"><EvolutionChart rows={data?.daily ?? []} /></div></article>
          <article className="panel"><div className="panel-head"><div><h2 className="panel-title">Agir agora</h2><p className="panel-description">Sugestões ordenadas por impacto financeiro.</p></div></div><div className="alerts">{(data?.alerts ?? []).slice().sort((a, b) => numeric(a.prioridade) - numeric(b.prioridade) || numeric(b.impacto) - numeric(a.impacto)).slice(0, 7).map((alert) => <div className="alert-row" key={`${alert.campaign_id}-${alert.tipo}`}><span className={`alert-type ${alert.tipo}`}>{alert.tipo}</span><div><div className="alert-campaign">{alert.label}</div><div className="alert-detail">{alert.detalhe}</div></div><div className={`alert-impact ${classForValue(alert.impacto)}`}>{money(alert.impacto)}</div></div>)}{!(data?.alerts ?? []).length && <div className="empty-state">Nenhuma ação pendente neste período.</div>}</div></article>
        </section>
        <section className="panel table-panel"><div className="panel-head table-head"><div><h2 className="panel-title">Ranking de campanhas</h2><p className="panel-description">Este detalhe respeita o período filtrado no painel.</p></div><div className="table-tools"><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar campanha, nicho ou código" aria-label="Buscar campanha" /></div></div><div className="table-scroller"><table><thead><tr><th>Campanha</th><th>Gasto</th><th>Receita líq.</th><th>Lucro</th><th>ROI</th><th>Tendência</th><th>Ação</th></tr></thead><tbody>{filteredRanking.map((row) => { const recommendation = row.recomendacao ?? "acompanhar"; const trend = row.tendencia ?? "indefinida"; return <tr key={row.campaign_id}><td><button className="campaign-button" onClick={() => openPeriodDrawer(row)}>{row.label}</button></td><td>{preciseMoney(row.spend)}</td><td>{preciseMoney(row.rev_adj)}</td><td className={classForValue(row.profit)}>{preciseMoney(row.profit)}</td><td className={classForValue(row.roi)}>{percent(row.roi)}</td><td><span className={`trend ${trend === "subindo" ? "up" : trend === "caindo" ? "down" : ""}`}>{trend === "subindo" ? "↑" : trend === "caindo" ? "↓" : "→"} {trend}</span></td><td><span className={`recommendation ${recommendation}`}>{recommendation.replaceAll("_", " ")}</span></td></tr>; })}{!filteredRanking.length && <tr><td colSpan={7}><div className="empty-state">Nenhuma campanha encontrada neste período.</div></td></tr>}</tbody></table></div></section>
        <p className="source-note">Dados consolidados do Supabase. A coluna lateral usa o histórico completo; o ranking respeita o filtro acima.</p>
      </>}</div>
    </div>
    {drawer && <CampaignDrawer campaign={drawer.campaign} daily={drawer.rows} scopeLabel={drawer.scopeLabel} onClose={() => setDrawer(null)} />}
  </div></main>;
}
