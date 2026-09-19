/**
 * Global search page index (pure, no React).
 *
 * Every entry is a REAL application route from `client/src/app/routes.tsx`
 * (labels mirror the sidebar navigation). No backend involved: selecting a
 * page navigates to it. Lead results come separately from the live
 * GET /api/v1/leads search endpoint (never fabricated).
 */

export interface SearchPage {
  label: string;
  path: string;
  keywords: string;
}

export const SEARCH_PAGES: SearchPage[] = [
  { label: "Dashboard", path: "/dashboard", keywords: "dashboard home overview" },
  { label: "Leads", path: "/leads", keywords: "leads pipeline shippers" },
  { label: "Conversations", path: "/conversations", keywords: "conversations text chat messages" },
  { label: "Qualifications", path: "/qualifications", keywords: "qualifications scores tiers hot warm cold" },
  { label: "Follow-ups", path: "/followups", keywords: "followups follow-ups reminders scheduled" },
  { label: "Calendar", path: "/calendar", keywords: "calendar meetings bookings schedule" },
  { label: "Knowledge Base", path: "/knowledge", keywords: "knowledge base documents search ingest" },
  { label: "AI Agent", path: "/ai-agent", keywords: "ai agent assistant configuration" },
  { label: "CRM", path: "/crm", keywords: "crm sync contacts hubspot" },
  { label: "WhatsApp", path: "/whatsapp", keywords: "whatsapp messages templates" },
  { label: "Automation", path: "/automation", keywords: "automation workflows n8n" },
  { label: "Activity", path: "/activity", keywords: "activity timeline" },
  { label: "Notifications", path: "/notifications", keywords: "notifications alerts" },
  { label: "Settings", path: "/settings", keywords: "settings preferences" },
  { label: "Profile", path: "/profile", keywords: "profile account user" },
  { label: "Help", path: "/help", keywords: "help support docs" },
];

/** Case-insensitive substring match over label, path, and keywords. */
export function filterSearchPages(query: string): SearchPage[] {
  const q = query.trim().toLowerCase();
  if (!q) return SEARCH_PAGES;
  return SEARCH_PAGES.filter((page) =>
    `${page.label} ${page.path} ${page.keywords}`.toLowerCase().includes(q)
  );
}
