import {
  Activity,
  Bell,
  Bot,
  CircleHelp,
  CalendarDays,
  Clock3,
  Database,
  FileText,
  LayoutDashboard,
  MessageCircle,
  MessageSquareText,
  Network,
  Phone,
  Settings,
  Target,
  UserCircle2,
  Users,
} from "lucide-react";

export type IconType = typeof Activity;


export type Lead = {
  id: string;
  initials: string;
  name: string;
  company: string;
  phone: string;
  route: string;
  vehicle: string;
  cargo: string;
  budget: string;
  tier: "HOT" | "WARM" | "COLD";
  score: number;
  /**
   * Phase 19 — true only for backend rows adapted without a persisted
   * qualification. The list renders "—" instead of the tier/score so an
   * unscored lead never wears a fabricated badge. Mock rows omit it.
   */
  signalUnknown?: boolean;
  status: string;
  last: string;
  created: string;
  color: string;
};

/**
 * Phase 4 — the hardcoded demo lead rows lived here and were rendered as
 * production data (dashboard activity, operations tables, detail lookups).
 * They are deleted: every production view now reads the backend. The `Lead`
 * display-adapter type stays because `leadDisplay` + `TierBadge` reuse it
 * for real backend rows (never for fixture rows — none remain).
 */

/**
 * Phase 4 — navigation carries no counts. The old static badges ("24", "5",
 * "3", "Optional") pretended to be backend totals; counts now live next to
 * the data they describe (dashboard summary, list pagination).
 */
export const navGroups: { label: string; items: { label: string; icon: IconType; path: string }[] }[] = [
  { label: "OPERATIONS", items: [
    { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
    { label: "Leads", icon: Users, path: "/leads" },
    { label: "Conversations", icon: MessageSquareText, path: "/conversations" },
    { label: "Qualifications", icon: Target, path: "/qualifications" },
    { label: "Follow-ups", icon: Clock3, path: "/followups" },
  ] },
  { label: "AI SYSTEMS", items: [
    { label: "AI Agent", icon: Bot, path: "/ai-agent" },
    { label: "Knowledge Base", icon: FileText, path: "/knowledge" },
  ] },
  { label: "INTEGRATIONS", items: [
    { label: "CRM", icon: Database, path: "/crm" },
    { label: "WhatsApp", icon: MessageCircle, path: "/whatsapp" },
    { label: "Calendar", icon: CalendarDays, path: "/calendar" },
    { label: "Automation / n8n", icon: Network, path: "/automation" },
  ] },
  { label: "SYSTEM", items: [
    { label: "Activity", icon: Activity, path: "/activity" },
    { label: "Notifications", icon: Bell, path: "/notifications" },
    { label: "Settings", icon: Settings, path: "/settings" },
    { label: "Profile", icon: UserCircle2, path: "/profile" },
    { label: "Help", icon: CircleHelp, path: "/help" },
  ] },
];

export const pageMeta: Record<string, { title: string; eyebrow: string; description: string }> = {
  "/dashboard": { title: "Operations overview", eyebrow: "GOOD MORNING, MAYA", description: "Here’s the signal from your logistics pipeline today." },
  "/leads": { title: "Leads", eyebrow: "PIPELINE / LEADS", description: "Qualify, route, and move every opportunity forward." },
  "/conversations": { title: "Conversations", eyebrow: "OPERATIONS / TEXT CHAT", description: "Real-time text conversations with the logistics assistant." },
  "/qualifications": { title: "Qualifications", eyebrow: "OPERATIONS / SIGNAL", description: "Review the quality and intent behind every lead." },
  "/followups": { title: "Follow-ups", eyebrow: "OPERATIONS / FOLLOW-UPS", description: "Keep the next best action in motion." },
  "/ai-agent": { title: "AI agent", eyebrow: "AI SYSTEMS / ASSISTANT", description: "Tune the assistant that qualifies your next customer." },
  "/knowledge": { title: "Knowledge base", eyebrow: "AI SYSTEMS / RETRIEVAL", description: "The logistics intelligence layer behind every conversation." },
  "/crm": { title: "CRM sync", eyebrow: "INTEGRATIONS / CRM", description: "Keep your customer record and qualification signal aligned." },
  "/whatsapp": { title: "WhatsApp", eyebrow: "INTEGRATIONS / MESSAGING", description: "Turn a qualified conversation into a timely follow-up." },
  "/calendar": { title: "Calendar", eyebrow: "INTEGRATIONS / MEETINGS", description: "Convert intent into a confirmed next conversation." },
  "/automation": { title: "Automation center", eyebrow: "INTEGRATIONS / N8N · OPTIONAL", description: "Optional external workflows — core MadLead flows run without n8n." },
  "/activity": { title: "Activity", eyebrow: "SYSTEM / AUDIT TRAIL", description: "A complete operational timeline, ready for review." },
  "/notifications": { title: "Notifications", eyebrow: "SYSTEM / SIGNALS", description: "Operational alerts that need your attention." },
  "/settings": { title: "Settings", eyebrow: "SYSTEM / CONFIGURATION", description: "Shape the way MadLead AI works for your team." },
  "/profile": { title: "Profile", eyebrow: "SYSTEM / YOUR ACCOUNT", description: "Manage your identity and workspace details." },
  "/help": { title: "Help & support", eyebrow: "SYSTEM / SUPPORT", description: "Find guidance for the MadLead AI workspace." },
};
