import { useState } from "react";
import { useLocation } from "wouter";
import {
  Clock3,
  Filter,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Target,
} from "lucide-react";
import { Button, Card, TierBadge } from "@/components/app/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { filterQualificationRows, useCreateQualificationMutation, useQualificationRows } from "@/api/hooks/useQualifications";
import { toDisplayLead } from "@/api/hooks/leadDisplay";
import { getUserMessage } from "@/api/errors";
import { leads, pageMeta } from "@/mock/pipeline";
import type { IconType, Lead } from "@/mock/pipeline";
import { qualIds } from "@/mock/details";

export function OperationsPage({ type, onToast }: { type: string; onToast: (message: string) => void }) {
  const [, navigate] = useLocation();
  const isQual = type === "/qualifications";
  const [tierFilter, setTierFilter] = useState("All signals");
  const [refreshing, setRefreshing] = useState(false);
  const qualData = useQualificationRows(20, { enabled: isQual });
  const qualRows = filterQualificationRows(qualData.rows, tierFilter);
  const rerunMutation = useCreateQualificationMutation();
  const handleRefresh = () => {
    if (!isQual) {
      onToast("Queue refreshed");
      return;
    }
    if (refreshing) return;
    setRefreshing(true);
    void qualData.refetch().finally(() => setRefreshing(false));
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
  const configs: Record<string, { label: string; title: string; icon: IconType; rows: [string, string, string, string][] }> = {
    "/qualifications": { label: "SIGNAL REVIEW", title: "Latest qualification results", icon: Target, rows: [["Arjun Rao", "92", "HOT", "Chennai → Mumbai"], ["Meera Shah", "87", "HOT", "Surat → Delhi"], ["Priya Srinivas", "84", "HOT", "Bengaluru → Kochi"], ["Vikram Kulkarni", "71", "WARM", "Pune → Hyderabad"], ["Nisha Khatri", "66", "WARM", "Kolkata → Lucknow"]]},
    "/followups": { label: "ACTION QUEUE", title: "Upcoming actions", icon: Clock3, rows: [["Arjun Rao", "Send WhatsApp summary", "Today · 16:00", "Pending"], ["Vikram Kulkarni", "Retry AI call", "Tomorrow · 09:30", "Scheduled"], ["Nisha Khatri", "Share reefer quote", "Tomorrow · 11:00", "Scheduled"], ["Rohan Sethi", "Qualification check-in", "12 Sep · 15:30", "Pending"], ["Shah Textiles", "Booking confirmation", "13 Sep · 10:00", "Completed"]]},
  };
  const config = configs[type] ?? configs["/qualifications"];
  return <><div className="page-heading"><div><p className="lede">{pageMeta[type]?.description}</p></div><div className="heading-actions"><Button icon={RefreshCw} variant="secondary" onClick={handleRefresh} disabled={isQual && refreshing}>{isQual && refreshing ? "Refreshing…" : "Refresh"}</Button>{type === "/followups" ? <Button icon={Plus} variant="primary" onClick={() => onToast("Follow-up scheduler opened")}>Schedule follow-up</Button> : null}</div></div><div className="ops-stat-grid"><Card><span className="section-kicker">ACTIVE NOW</span><strong>{isQual ? "—" : type === "/followups" ? "12" : "186"}</strong><small>{isQual ? "No aggregate endpoint" : type === "/followups" ? "scheduled actions" : "qualified leads"}</small></Card><Card><span className="section-kicker">COMPLETION RATE</span><strong>{isQual ? "—" : type === "/followups" ? "88.6%" : "72.4%"}</strong><small>{isQual ? "No aggregate endpoint" : "last 7 days"}</small></Card><Card><span className="section-kicker">AVG. LATENCY</span><strong>{isQual ? "—" : "2.4 min"}</strong><small>{isQual ? "No aggregate endpoint" : "system response"}</small></Card><Card><span className="section-kicker">NEEDS ATTENTION</span><strong className="amber-text">{isQual ? "—" : "5"}</strong><small>{isQual ? "No aggregate endpoint" : "requires review"}</small></Card></div><Card className="table-card"><div className="card-header table-header"><div><span className="section-kicker">{config.label}</span><h2>{config.title}</h2></div><div className="filter-row">{isQual ? <select className="filter-select" value={tierFilter} onChange={e => setTierFilter(e.target.value)}><option>All signals</option><option>HOT</option><option>WARM</option><option>COLD</option></select> : <button className="filter-select"><Filter size={14} /> Filter</button>}<button className="more-btn"><MoreHorizontal size={17} /></button></div></div><div className="table-wrap"><table><thead><tr><th>Lead</th><th>{type === "/qualifications" ? "Score" : "Action"}</th><th>{type === "/qualifications" ? "Tier" : "Scheduled time"}</th><th>{type === "/qualifications" ? "Route" : "Outcome"}</th><th>Status</th><th /></tr></thead><tbody>{isQual ? (qualData.isPending ? <tr><td colSpan={6}><div className="empty-state"><b>Loading qualifications…</b></div></td></tr> : qualData.isError ? <tr><td colSpan={6}><div className="empty-state"><b>Couldn&apos;t load qualifications</b><span>{getUserMessage(qualData.error)}</span><Button variant="secondary" onClick={() => { void qualData.refetch(); }}>Retry</Button></div></td></tr> : !qualRows.length ? <tr><td colSpan={6}><div className="empty-state"><b>No qualifications yet.</b><span>Qualifications appear here after conversations are qualified.</span></div></td></tr> : qualRows.map(({ lead, qualification }) => { const display = toDisplayLead(lead); return <tr key={qualification.id} onClick={() => navigate(`/leads/${lead.id}`)}><td><div className="person-cell"><span className="person-avatar small" style={{ background: `${display.color}18`, color: display.color }}>{display.initials}</span><span><b>{lead.name}</b><small>{display.company}</small></span></div></td><td>{qualification.score}</td><td><TierBadge tier={qualification.tier} /></td><td>—</td><td><span className="status-pill"><i />{lead.status}</span></td><td><DropdownMenu><DropdownMenuTrigger asChild><button className="row-more" onClick={e => e.stopPropagation()}><MoreHorizontal size={16} /></button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={() => navigate(`/leads/${lead.id}`)}>View lead</DropdownMenuItem><DropdownMenuItem onSelect={() => navigate(`/qualifications/${lead.id}`)}>View qualification</DropdownMenuItem><DropdownMenuItem onSelect={() => { if (qualification.call_id) handleRerun(qualification.call_id); }} disabled={rerunMutation.isPending || !qualification.call_id}>Re-run qualification</DropdownMenuItem></DropdownMenuContent></DropdownMenu></td></tr> })) : config.rows.map((row, i) => <tr key={row[0]} onClick={() => { if (type === "/qualifications") navigate(`/qualifications/${qualIds[i % qualIds.length]}`); }}><td><div className="person-cell"><span className="person-avatar small" style={{ background: `${leads[i % leads.length].color}18`, color: leads[i % leads.length].color }}>{leads[i % leads.length].initials}</span><span><b>{row[0]}</b><small>{leads[i % leads.length].company}</small></span></div></td><td>{row[1]}</td><td>{row[2]}</td><td>{type === "/qualifications" ? <TierBadge tier={row[2] as Lead["tier"]} /> : <span className="status-pill"><i />{row[3]}</span>}</td><td><span className={`status-label ${row[3].toLowerCase().includes("qualified") || row[3] === "Completed" ? "success" : row[3] === "No answer" ? "muted-status" : ""}`}>{row[3]}</span></td><td><button className="row-more" onClick={e => { e.stopPropagation(); onToast("Row actions opened") }}><MoreHorizontal size={16} /></button></td></tr>)}</tbody></table></div></Card></>;
}
