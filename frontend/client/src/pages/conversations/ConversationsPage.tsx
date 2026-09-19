import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, ChevronRight, MessageSquarePlus, Search } from "lucide-react";
import { Button, Card, TierBadge } from "@/components/app/ui";
import { LeadPicker } from "@/components/app/LeadPicker";
import { NO_CONVERSATIONS_COPY, conversationErrorCopy, displayCustomerName, formatStatusLabel } from "@/components/app/conversationView";
import { ApiError } from "@/api/errors";
import { useConversationsQuery, useCreateConversationMutation } from "@/api/hooks/useConversations";
import { useConversationQualificationQuery } from "@/api/hooks/useConversations";
import type { Conversation } from "@/api/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PAGE_SIZE = 20;

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function QualificationCell({ conversationId }: { conversationId: string }) {
  const qualification = useConversationQualificationQuery(conversationId);
  if (qualification.isPending) return <small className="table-sub">…</small>;
  if (qualification.data) return <TierBadge tier={qualification.data.tier} />;
  return <small className="table-sub">—</small>;
}

function ConversationsPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<"" | "web" | "whatsapp" | "legacy_voice">("");
  const [status, setStatus] = useState<"" | "active" | "completed" | "abandoned">("");
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(null);

  const list = useConversationsQuery({
    status: status || undefined,
    channel: channel || undefined,
    page,
    limit: PAGE_SIZE,
  });
  const create = useCreateConversationMutation();

  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // The list endpoint supports lead/status/channel filters but no text
  // search, so the search box filters the fetched page client-side.
  // Customer name is the primary field; id/channel/status stay searchable.
  const rows: Conversation[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = list.data?.conversations ?? [];
    if (!q) return all;
    return all.filter((c) =>
      `${c.id} ${c.lead_id ?? ""} ${c.lead?.name ?? ""} ${c.lead?.email ?? ""} ${c.lead?.phone ?? ""} ${c.channel} ${c.status}`.toLowerCase().includes(q)
    );
  }, [list.data, search]);

  const startNew = () => {
    create.mutate(
      { leadId, channel: "web" },
      {
        onSuccess: (conversation) => {
          setNewOpen(false);
          setLeadId(null);
          navigate(`/conversations/${conversation.id}`);
        },
      }
    );
  };

  // Truthful 401 handling: the session is backend-verified, so an
  // unauthorized list means signed-out — offer Sign in, never a token modal.
  const listUnauthorized = list.isError && list.error instanceof ApiError && list.error.kind === "unauthorized";

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="lede">Real-time text conversations with the logistics assistant.</p>
        </div>
        <div className="heading-actions">
          <Button icon={MessageSquarePlus} variant="primary" onClick={() => setNewOpen(true)}>
            New Conversation
          </Button>
        </div>
      </div>
      <Card className="table-card conversations-table-card">
        <div className="toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer, phone, id…"
              aria-label="Search conversations by customer, phone, or id"
            />
          </div>
          <div className="filter-row">
            <select value={channel} onChange={(e) => { setChannel(e.target.value as typeof channel); setPage(1); }} aria-label="Filter by channel">
              <option value="">All channels</option>
              <option value="web">web</option>
              <option value="whatsapp">whatsapp</option>
              <option value="legacy_voice">legacy_voice</option>
            </select>
            <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} aria-label="Filter by status">
              <option value="">All statuses</option>
              <option value="active">active</option>
              <option value="completed">completed</option>
              <option value="abandoned">abandoned</option>
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Conversation</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Signal</th>
                <th>Latest activity</th>
              </tr>
            </thead>
            <tbody>
              {list.isPending ? (
                <tr><td colSpan={5}><div className="empty-state"><b>Loading conversations…</b></div></td></tr>
              ) : list.isError ? (
                <tr><td colSpan={5}><div className="empty-state"><b>Couldn&apos;t load conversations</b><span>{conversationErrorCopy(list.error)}</span>{listUnauthorized ? <Button variant="secondary" onClick={() => navigate("/login")}>Sign in</Button> : <Button variant="secondary" onClick={() => { void list.refetch(); }}>Retry</Button>}</div></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5}><div className="empty-state"><b>{NO_CONVERSATIONS_COPY}</b></div></td></tr>
              ) : (
              rows.map((c) => (
                <tr
                  key={c.id}
                  tabIndex={0}
                  onClick={() => navigate(`/conversations/${c.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/conversations/${c.id}`);
                    }
                  }}
                  aria-label={`Open conversation with ${displayCustomerName(c.lead?.name)}`}
                >
                  <td className="conv-customer-cell">
                    <b className="table-main conv-customer-name" title={displayCustomerName(c.lead?.name)}>
                      {displayCustomerName(c.lead?.name)}
                    </b>
                    <small className="table-sub conv-customer-sub" title={c.id}>{c.id.slice(0, 8)}…</small>
                  </td>
                  <td><small className="table-sub">{c.channel}</small></td>
                  <td><small className="table-sub">{formatStatusLabel(c.status)}</small></td>
                  <td><QualificationCell conversationId={c.id} /></td>
                  <td><small className="table-sub">{timeAgo(c.updated_at)}</small></td>
                </tr>
              ))
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination-row">
          <Button variant="secondary" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft size={15} />
          </Button>
          <span>Page {page} of {totalPages} · {total} total</span>
          <Button variant="secondary" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight size={15} />
          </Button>
        </div>
      </Card>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Conversation</DialogTitle>
            <DialogDescription>
              Optionally link an existing lead. The channel defaults to web and the
              conversation is created on the backend.
            </DialogDescription>
          </DialogHeader>
          <LeadPicker value={leadId} onChange={setLeadId} disabled={create.isPending} />
          {create.isError ? (
            <p className="text-sm text-destructive">{conversationErrorCopy(create.error)}</p>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={startNew} disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create & open"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ConversationsPage;
