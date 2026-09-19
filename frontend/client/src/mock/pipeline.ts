import {
  Activity,
  Bell,
  Bot,
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
  status: string;
  last: string;
  created: string;
  color: string;
};

export const leads: Lead[] = [
  { id: "LD-1048", initials: "AR", name: "Arjun Rao", company: "Rao Exports", phone: "+91 98765 22109", route: "Chennai → Mumbai", vehicle: "32 ft Multi Axle", cargo: "Auto components", budget: "₹78,000", tier: "HOT", score: 92, status: "Qualified", last: "8 min ago", created: "Today, 09:32", color: "#00f0ff" },
  { id: "LD-1047", initials: "MS", name: "Meera Shah", company: "Shah Textiles", phone: "+91 98210 80451", route: "Surat → Delhi", vehicle: "22 ft Container", cargo: "Textiles", budget: "₹54,500", tier: "HOT", score: 87, status: "Call completed", last: "24 min ago", created: "Today, 08:48", color: "#8b5cf6" },
  { id: "LD-1046", initials: "VK", name: "Vikram Kulkarni", company: "VK Industrial", phone: "+91 99870 14402", route: "Pune → Hyderabad", vehicle: "24 ft Open", cargo: "Machinery", budget: "₹41,200", tier: "WARM", score: 71, status: "Follow-up due", last: "1 hr ago", created: "Today, 08:06", color: "#f59e0b" },
  { id: "LD-1045", initials: "NK", name: "Nisha Khatri", company: "Khatri Foods", phone: "+91 98102 66420", route: "Kolkata → Lucknow", vehicle: "20 ft Reefer", cargo: "Frozen foods", budget: "₹63,000", tier: "WARM", score: 66, status: "In review", last: "2 hrs ago", created: "Today, 07:20", color: "#ef8354" },
  { id: "LD-1044", initials: "RS", name: "Rohan Sethi", company: "Sethi Retail", phone: "+91 99100 73218", route: "Jaipur → Bengaluru", vehicle: "32 ft Trailer", cargo: "FMCG", budget: "₹92,000", tier: "COLD", score: 38, status: "New", last: "4 hrs ago", created: "Yesterday, 18:42", color: "#64748b" },
  { id: "LD-1043", initials: "PS", name: "Priya Srinivas", company: "PS Pharma", phone: "+91 98860 49210", route: "Bengaluru → Kochi", vehicle: "14 ft Closed", cargo: "Pharma", budget: "₹22,700", tier: "HOT", score: 84, status: "Qualified", last: "Yesterday", created: "Yesterday, 16:18", color: "#22c55e" },
];

export const navGroups: { label: string; items: { label: string; icon: IconType; path: string; badge?: string }[] }[] = [
  { label: "OPERATIONS", items: [
    { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
    { label: "Leads", icon: Users, path: "/leads", badge: "24" },
    { label: "Conversations", icon: MessageSquareText, path: "/conversations" },
    { label: "Qualifications", icon: Target, path: "/qualifications" },
    { label: "Follow-ups", icon: Clock3, path: "/followups", badge: "5" },
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
    { label: "Notifications", icon: Bell, path: "/notifications", badge: "3" },
    { label: "Settings", icon: Settings, path: "/settings" },
    { label: "Profile", icon: UserCircle2, path: "/profile" },
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
  "/automation": { title: "Automation center", eyebrow: "INTEGRATIONS / N8N", description: "Observe the workflows that keep operations moving." },
  "/activity": { title: "Activity", eyebrow: "SYSTEM / AUDIT TRAIL", description: "A complete operational timeline, ready for review." },
  "/notifications": { title: "Notifications", eyebrow: "SYSTEM / SIGNALS", description: "Operational alerts that need your attention." },
  "/settings": { title: "Settings", eyebrow: "SYSTEM / CONFIGURATION", description: "Shape the way MadVoice AI works for your team." },
  "/profile": { title: "Profile", eyebrow: "SYSTEM / YOUR ACCOUNT", description: "Manage your identity and workspace details." },
};
