import { useState } from "react";
import { useLocation } from "wouter";
import {
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import { Button, Card, TierBadge } from "@/components/app/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { filterQualificationRows, useCreateQualificationMutation, useQualificationRows, useQualificationMixQuery } from "@/api/hooks/useQualifications";
import { useDashboardSummaryQuery } from "@/api/hooks/useDashboard";
import { toDisplayLead } from "@/api/hooks/leadDisplay";
import { getUserMessage } from "@/api/errors";
import { pageMeta } from "@/mock/pipeline";

/**
 * Phase 4 — qualifications list from real backend data only.
 *
 * Rows come from `useQualificationRows` (real leads crossed with their
 * per-lead qualification lookup; unscored leads contribute no row — never
 * fabricated). Aggregate cards are LIVE via GET /api/v1/dashboard/summary
 * and the qualification-mix endpoint (SQL counts); a failed aggregate
 * renders "—" with retry, never an invented number. The old hardcoded
 * signal rows, fixture deep-links, and demo stat numbers are removed, as
 * is the dead non-qualifications branch (this page serves /qualifications
 * only; follow-ups live on FollowupsPage).
 */
export function OperationsPage({ type, onToast }: { type: string; onToast: (message: string) => void }) {
  const [, navigate] = useLocation();
  const [tierFilter, setTierFilter] = useState("All signals");
  const [refreshing, setRefreshing] = useState(false);
  const qualData = useQualificationRows(20);
  const qualRows = filterQualificationRows(qualData.rows, tierFilter);
  const qualMix = useQualificationMixQuery();
  const summary = useDashboardSummaryQuery();
  const rerunMutation = useCreateQualificationMutation();
  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void Promise.all([qualData.refetch(), qualMix.refetch(), summary.refetch()]).finally(() =>
      setRefreshing(false)
    );
  };
  const handleRerun = (callId: string) => {
    if (rerunMutation.isPending) return;
    rerunMutation.mutate(
      { callId },
      {
        onSuccess: (q) => onToast(`Qualification updated · ${q.tier} ${q.score}`),
        onError: (error) => onToast(getUserMessage(error)),
      }
    );
  };
  const statValue = (value: number | undefined, pending: boolean, failed: boolean) =>
    pending ? "…" : failed || value === undefined ? "—" : String(value);
  const statsFailed = summary.isError && qualMix.isError;
  return <><div className="page-heading"><div><p className="lede">{pageMeta[type]?.description}</p></div><div className="heading-actions"><Button icon={RefreshCw} variant="secondary" onClick={handleRefresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</Button></div></div><div className="ops-stat-grid"><Card><span className="section-kicker">SCORED LEADS</span><strong>{statValue(summary.data?.qualifications.total, summary.isPending, summary.isError)}</strong><small>persisted qualification records</small></Card><Card><span className="section-kicker">HOT</span><strong>{statValue(qualMix.data?.hot, qualMix.isPending, qualMix.isError)}</strong><small>highest intent tier</small></Card><Card><span className="section-kicker">WARM</span><strong>{statValue(qualMix.data?.warm, qualMix.isPending, qualMix.isError)}</strong><small>nurture tier</small></Card><Card><span className="section-kicker">COLD</span><strong>{statValue(qualMix.data?.cold, qualMix.isPending, qualMix.isError)}</strong><small>low intent tier</small></Card></div>{statsFailed && <Card className="tab-panel" style={{ marginBottom: 12 }}><div className="empty-state"><b>Couldn&apos;t load qualification totals</b><span>Row data below is unaffected.</span><Button variant="secondary" onClick={handleRefresh}>Retry</Button></div></Card>}<Card className="table-card"><div className="card-header table-header"><div><span className="section-kicker">SIGNAL REVIEW</span><h2>Latest qualification results</h2></div><div className="filter-row"><select className="filter-select" value={tierFilter} onChange={e => setTierFilter(e.target.value)} aria-label="Filter by signal tier"><option>All signals</option><option>HOT</option><option>WARM</option><option>COLD</option></select></div></div><div className="table-wrap"><table><thead><tr><th>Lead</th><th>Score</th><th>Tier</th><th>Route</th><th>Status</th><th /></tr></thead><tbody>{qualData.isPending ? <tr><td colSpan={6}><div className="empty-state"><b>Loading qualifications…</b></div></td></tr> : qualData.isError ? <tr><td colSpan={6}><div className="empty-state"><b>Couldn&apos;t load qualifications</b><span>{getUserMessage(qualData.error)}</span><Button variant="secondary" onClick={() => { void qualData.refetch(); }}>Retry</Button></div></td></tr> : !qualRows.length ? <tr><td colSpan={6}><div className="empty-state"><b>No qualifications yet.</b><span>Qualifications appear here after conversations are qualified.</span></div></td></tr> : qualRows.map(({ lead, qualification }) => { const display = toDisplayLead(lead); return <tr key={qualification.id} onClick={() => navigate(`/leads/${lead.id}`)}><td><div className="person-cell"><span className="person-avatar small" style={{ background: `${display.color}18`, color: display.color }}>{display.initials}</span><span><b>{lead.name}</b><small>{display.company}</small></span></div></td><td>{qualification.score}</td><td><TierBadge tier={qualification.tier} /></td><td>—</td><td><span className="status-pill"><i />{lead.status}</span></td><td><DropdownMenu><DropdownMenuTrigger asChild><button className="row-more" onClick={e => e.stopPropagation()} aria-label="Qualification actions"><MoreHorizontal size={16} /></button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={() => navigate(`/leads/${lead.id}`)}>View lead</DropdownMenuItem><DropdownMenuItem onSelect={() => navigate(`/qualifications/${lead.id}`)}>View qualification</DropdownMenuItem><DropdownMenuItem onSelect={() => { if (qualification.call_id) handleRerun(qualification.call_id); }} disabled={rerunMutation.isPending || !qualification.call_id}>Re-run qualification</DropdownMenuItem></DropdownMenuContent></DropdownMenu></td></tr> })}</tbody></table></div></Card></>;
}
