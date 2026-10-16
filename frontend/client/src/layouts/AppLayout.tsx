import { createContext, useCallback, useContext, useState } from "react";
import { useLocation } from "wouter";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Menu,
  MoreHorizontal,
} from "lucide-react";
import { Logo, Toast } from "@/components/app/ui";
import { GlobalSearch } from "@/components/app/GlobalSearch";
import { navGroups, pageMeta } from "@/mock/pipeline";
import { useSessionQuery } from "@/api/hooks/useSession";
import { displayUserName, userInitials } from "@/components/app/userDisplay";
import { canAccessPath, isInternalRole } from "@/app/accessPolicy";

type ToastContextValue = { notify: (message: string) => void };

const ToastContext = createContext<ToastContextValue>({ notify: () => undefined });

export const useToast = () => useContext(ToastContext);

/**
 * Phase 21 — role-aware navigation (ADMIN vs USER).
 *
 * The backend is the real boundary; shared route policy keeps sidebar and
 * topbar destinations consistent with direct route access.
 */
export function visibleNavGroups(role: unknown) {
  if (!isInternalRole(role)) return [];
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessPath(role, item.path)),
    }))
    .filter((group) => group.items.length > 0);
}

export function isNavPathActive(currentPath: string, itemPath: string): boolean {
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}

/**
 * Phase 21 — dashboard greeting from the authenticated session (never a
 * hardcoded name): time-of-day + the user's first name, or a neutral
 * fallback when signed out/unnamed.
 */
export function dashboardEyebrow(name: unknown, now: Date = new Date()): string {
  const hour = now.getHours();
  const part = hour < 12 ? "GOOD MORNING" : hour < 17 ? "GOOD AFTERNOON" : "GOOD EVENING";
  const first = typeof name === "string" ? name.trim().split(/\s+/)[0] ?? "" : "";
  return first ? `${part}, ${first.toUpperCase()}` : part;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<string | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }, []);
  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </ToastContext.Provider>
  );
}

export function AppLayout({ children, path }: { children: React.ReactNode; path: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [, navigate] = useLocation();
  const meta = pageMeta[path] ?? pageMeta["/dashboard"];
  // Single session source (shared cache with Profile): never hardcoded.
  const session = useSessionQuery();
  const userName = displayUserName(session.data?.name);
  const userEmail = session.data?.email?.trim() || "—";
  const initials = session.isPending ? "…" : userInitials(session.data?.name);
  const role = session.data?.role;
  const groups = visibleNavGroups(role);
  const eyebrow = path === "/dashboard" ? dashboardEyebrow(session.data?.name) : meta.eyebrow;
  return <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="sidebar-head"><Logo compact={collapsed} /><button className="collapse-btn" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</button></div>
      <div className="workspace-switcher"><span className="workspace-avatar">{initials}</span><span className="workspace-copy"><b>{session.isPending ? "Loading…" : userName}</b><small>{session.isPending ? "Restoring session…" : userEmail}</small></span></div>
      <nav className="sidebar-nav">{groups.map(group => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>{group.items.map(item => { const active = isNavPathActive(path, item.path); return <button key={item.path} onClick={() => { navigate(item.path); setMobileOpen(false); }} className={`nav-item ${active ? "active" : ""}`} title={collapsed ? item.label : undefined}><item.icon size={17} /><span>{item.label}</span></button> })}</div>)}</nav>
      <div className="sidebar-bottom"><div className="status-mini"><span><b>{session.isPending ? "Connecting…" : session.data ? "Signed in" : "Signed out"}</b><small>{session.isPending ? "Restoring session…" : userEmail}</small></span></div><button className="profile-mini" onClick={() => navigate("/profile")} aria-label={`Open profile for ${userName}`}><span className="avatar">{initials}</span><span><b>{session.isPending ? "Loading…" : userName}</b><small>{session.isPending ? "…" : userEmail}</small></span><MoreHorizontal size={16} /></button></div>
    </aside>
    {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
    <main className="main-shell">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="topbar-title"><span>{eyebrow}</span><h1>{meta.title}</h1></div><div className="topbar-actions"><GlobalSearch role={role} />{canAccessPath(role, "/notifications") ? <button className="icon-btn" aria-label="Open notifications" onClick={() => navigate("/notifications")}><Bell size={18} /></button> : null}<button className="top-avatar" onClick={() => navigate("/profile")} aria-label="Open your profile">{initials}</button></div></header>
      <div className="page-content">{children}</div>
    </main>
  </div>;
}
