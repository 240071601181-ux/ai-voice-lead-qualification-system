import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { FileText, Search, User } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useLeadsQuery } from "@/api/hooks/useLeads";
import { getUserMessage } from "@/api/errors";
import { filterSearchPages } from "@/components/app/searchIndex";

const LEAD_SEARCH_LIMIT = 8;
const DEBOUNCE_MS = 250;

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Global "Search anything" command palette (topbar, every app page).
 *
 * - Opens via click, ⌘K / Ctrl+K; closes via Escape, selection, or backdrop.
 * - Lead results are LIVE from GET /api/v1/leads (debounced). Only the
 *   backend-supported searchable fields are used (name, phone, email,
 *   source, status — see leadRepository.searchWhere). No fake lead records.
 * - Page results are the real application routes (labels mirror the
 *   sidebar); no backend involved and no endpoints invented.
 * - Selecting a lead navigates to the real /leads/:id page (deep-link
 *   safe: the dev server serves index.html for SPA routes).
 */
export function GlobalSearch() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, DEBOUNCE_MS);
  const trimmed = debounced.trim();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const leadSearch = useLeadsQuery(
    { search: trimmed || undefined, page: 1, limit: LEAD_SEARCH_LIMIT },
    { enabled: open && trimmed.length > 0 }
  );
  const leads = leadSearch.data?.leads ?? [];
  const searching = trimmed.length > 0 && leadSearch.isFetching && leads.length === 0;
  const searchFailed = trimmed.length > 0 && leadSearch.isError && !leadSearch.isFetching;

  const pages = useMemo(() => filterSearchPages(query), [query]);

  const go = (path: string) => {
    setOpen(false);
    setQuery("");
    navigate(path);
  };

  return (
    <>
      <button className="global-search" onClick={() => setOpen(true)}>
        <Search size={16} />
        <span>Search anything</span>
        <kbd>⌘ K</kbd>
      </button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setQuery("");
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search</DialogTitle>
          <DialogDescription>Search leads and pages</DialogDescription>
        </DialogHeader>
        <DialogContent className="overflow-hidden p-0">
          <Command shouldFilter={false} label="Search">
            <CommandInput placeholder="Search leads, pages…" value={query} onValueChange={setQuery} autoFocus />
            <CommandList>
              {searching ? <CommandItem value="searching" disabled>Searching leads…</CommandItem> : null}
              {searchFailed ? (
                <CommandItem value="search-error" disabled>
                  Couldn&apos;t search leads: {getUserMessage(leadSearch.error)} — keep typing to retry.
                </CommandItem>
              ) : null}
              {pages.length > 0 ? (
                <CommandGroup heading="Pages">
                  {pages.map((page) => (
                    <CommandItem key={page.path} value={`page ${page.label} ${page.path}`} onSelect={() => go(page.path)}>
                      <FileText />
                      <span>{page.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {leads.length > 0 ? (
                <CommandGroup heading="Leads">
                  {leads.map((lead) => (
                    <CommandItem
                      key={lead.id}
                      value={`lead ${lead.id}`}
                      onSelect={() => go(`/leads/${lead.id}`)}
                    >
                      <User />
                      <span>
                        <b>{lead.name}</b>
                        <small style={{ display: "block", opacity: 0.7 }}>
                          {[lead.phone, lead.email].filter(Boolean).join(" · ")}
                        </small>
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>
                        {[lead.source, lead.status].filter(Boolean).join(" · ")}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              <CommandEmpty>No results found.</CommandEmpty>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
