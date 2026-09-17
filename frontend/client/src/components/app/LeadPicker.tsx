import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useLeadsQuery } from "@/api/hooks/useLeads";
import { getUserMessage } from "@/api/errors";
import type { Lead as ApiLead } from "@/api/types";

const DEFAULT_LIMIT = 8;
const DEBOUNCE_MS = 250;

/**
 * Shared real-lead radio picker (live GET /api/v1/leads, debounced
 * search). Never fabricates rows: loading/empty/error states only.
 * Used by Start AI Call and Schedule follow-up dialogs.
 */
export function LeadPicker({
  value,
  onChange,
  disabled,
  limit = DEFAULT_LIMIT,
}: {
  value: string | null;
  onChange: (leadId: string) => void;
  disabled?: boolean;
  limit?: number;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [search]);

  const leadsQuery = useLeadsQuery(
    { search: debounced.trim() || undefined, page: 1, limit },
    { enabled: !disabled }
  );
  const rows: ApiLead[] = leadsQuery.data?.leads ?? [];

  return (
    <>
      <div className="search-field">
        <Search size={16} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search leads by name, phone, email…"
          disabled={disabled}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, maxHeight: 280, overflowY: "auto" }}>
        {leadsQuery.isPending ? (
          <span style={{ fontSize: 12, color: "#8190a1" }}>Loading leads…</span>
        ) : leadsQuery.isError ? (
          <span style={{ fontSize: 12, color: "#f87171" }}>
            Couldn&apos;t load leads: {getUserMessage(leadsQuery.error)}{" "}
            <button className="link-btn" onClick={() => { void leadsQuery.refetch(); }}>Retry</button>
          </span>
        ) : !rows.length ? (
          <span style={{ fontSize: 12, color: "#8190a1" }}>
            {debounced.trim() ? "No leads match your search." : "No leads yet. Create a lead first."}
          </span>
        ) : (
          rows.map((lead) => (
            <label key={lead.id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: disabled ? "default" : "pointer" }}>
              <input
                type="radio"
                name="lead-picker"
                checked={value === lead.id}
                onChange={() => onChange(lead.id)}
                disabled={disabled}
              />
              <span style={{ flex: 1 }}>
                <b style={{ display: "block", fontSize: 13 }}>{lead.name}</b>
                <small style={{ color: "#8190a1", fontSize: 11 }}>
                  {[lead.phone, lead.email].filter(Boolean).join(" · ")}
                </small>
              </span>
              <small style={{ color: "#8190a1", fontSize: 11 }}>
                {[lead.source, lead.status].filter(Boolean).join(" · ")}
              </small>
            </label>
          ))
        )}
      </div>
    </>
  );
}
