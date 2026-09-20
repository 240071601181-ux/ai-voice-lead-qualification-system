import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  ListFilter,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import { Button, Card, TierBadge } from "@/components/app/ui";
import { pageMeta } from "@/mock/pipeline";
import { useToast } from "@/layouts/AppLayout";
import { useLeadsQuery } from "@/api/hooks/useLeads";
import { toDisplayLead } from "@/api/hooks/leadDisplay";
import { getUserMessage } from "@/api/errors";

const PAGE_SIZE = 20;

function LeadsPage({ onToast }: { onToast: (message: string) => void }) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("All signals");
  const [page, setPage] = useState(1);
  // Live backend list (GET /api/v1/leads). Search maps to the backend
  // `search` param; pagination maps to `page`/`limit`. The signal tier
  // select has no backend counterpart (leads store status only), so it
  // stays a client-side filter over the fetched page.
  const search = query.trim();
  const list = useLeadsQuery({ search: search || undefined, page, limit: PAGE_SIZE });
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const rows = useMemo(
    () =>
      (list.data?.leads ?? [])
        .map((api) => ({ display: toDisplayLead(api), email: api.email ?? null }))
        // Phase 19: backend rows carry no persisted signal — they match only
        // "All signals". (Mock rows keep their demo tiers for sandbox views.)
        .filter(({ display: l }) => tier === "All signals" || (!l.signalUnknown && l.tier === tier)),
    [list.data, tier]
  );
  const pageWindow = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, Math.min(page - 1, totalPages - 2));
    const end = Math.min(totalPages, start + 2);
    for (let p = start; p <= end; p++) pages.push(p);
    return pages;
  }, [page, totalPages]);
  const isFiltering = search.length > 0 || tier !== "All signals";
  return <><div className="page-heading"><div><p className="lede">{pageMeta["/leads"].description}</p></div><div className="heading-actions"><Button icon={Filter} variant="secondary" onClick={() => onToast("Advanced filters are ready")}>Filters <span className="btn-count">3</span></Button><Button icon={Plus} variant="primary" onClick={() => navigate("/leads/new")}>Create lead</Button></div></div><Card className="table-card"><div className="toolbar"><div className="search-field"><Search size={16} /><input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Search leads by name, phone, email…" aria-label="Search leads" /></div><div className="filter-row"><select value={tier} onChange={e => { setTier(e.target.value); setPage(1); }}><option>All signals</option><option>HOT</option><option>WARM</option><option>COLD</option></select><button className="filter-select"><ListFilter size={14} /> More filters <span className="filter-count">3</span></button></div></div><div className="table-wrap leads-table"><table><thead><tr><th>Lead</th><th>Email</th><th>Route</th><th>Vehicle</th><th>Budget</th><th>Signal</th><th>Status</th><th>Last contact</th><th /></tr></thead><tbody>{list.isPending ? <tr><td colSpan={9}><div className="empty-state"><b>Loading leads…</b></div></td></tr> : list.isError ? <tr><td colSpan={9}><div className="empty-state"><b>Couldn&apos;t load leads</b><span>{getUserMessage(list.error)}</span><Button variant="secondary" onClick={() => { void list.refetch(); }}>Retry</Button></div></td></tr> :               rows.map(({ display: lead, email }) => (
                <tr key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}><td><div className="person-cell"><span className="person-avatar" style={{ background: `${lead.color}18`, color: lead.color }}>{lead.initials}</span><span><b>{lead.name}</b><small>{lead.id} · {lead.phone}</small></span></div></td><td className="conv-customer-cell"><b className="table-main conv-customer-name" title={email ?? "No email"}>{email ?? "—"}</b></td><td><b className="table-main">{lead.route}</b><small className="table-sub">{lead.vehicle}</small></td><td>{lead.vehicle.split(" ").slice(0, 2).join(" ")}</td><td>{lead.budget}</td><td><div className="score-cell">{lead.signalUnknown ? <b className="table-main">—</b> : <><TierBadge tier={lead.tier} /><b>{lead.score}</b></>}</div></td><td><span className="status-pill"><i />{lead.status}</span></td><td className="muted">{lead.last}</td><td><button className="row-more" onClick={e => { e.stopPropagation(); onToast("Lead actions opened") }}><MoreHorizontal size={16} /></button></td></tr>))}{!list.isPending && !list.isError && !rows.length && <tr><td colSpan={9}><div className="empty-state"><Search size={22} /><b>{isFiltering ? "No leads match your current filters." : "No leads yet."}</b><span>{isFiltering ? "Try broadening your search or clearing a filter." : "Create your first lead to get started."}</span>{!isFiltering && <Button variant="primary" onClick={() => navigate("/leads/new")}>Create lead</Button>}</div></td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{rows.length}</b> of {total} leads</span><div className="pagination"><button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || list.isPending}><ChevronLeft size={14} /></button>{pageWindow.map(p => <button key={p} className={p === page ? "current" : ""} onClick={() => setPage(p)} disabled={list.isPending}>{p}</button>)}{totalPages > 3 && pageWindow[pageWindow.length - 1] < totalPages && <><span>…</span><button onClick={() => setPage(totalPages)} disabled={list.isPending}>{totalPages}</button></>}<button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || list.isPending}><ChevronRight size={14} /></button></div></div></Card></>;
}
export default function LeadsPageRoute() {
  const { notify } = useToast();
  return <LeadsPage onToast={notify} />;
}
