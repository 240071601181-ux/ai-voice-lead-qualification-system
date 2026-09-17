import { createContext, useCallback, useContext, useState } from "react";
import { useLocation } from "wouter";
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Menu,
  MoreHorizontal,
} from "lucide-react";
import { Logo, Toast } from "@/components/app/ui";
import { GlobalSearch } from "@/components/app/GlobalSearch";
import { navGroups, pageMeta } from "@/mock/pipeline";

type ToastContextValue = { notify: (message: string) => void };

const ToastContext = createContext<ToastContextValue>({ notify: () => undefined });

export const useToast = () => useContext(ToastContext);

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
  return <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="sidebar-head"><Logo compact={collapsed} /><button className="collapse-btn" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</button></div>
      <div className="workspace-switcher"><span className="workspace-avatar">AC</span><span className="workspace-copy"><b>Acme Cargo</b><small>Operations workspace</small></span><ChevronDown size={14} /></div>
      <nav className="sidebar-nav">{navGroups.map(group => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>{group.items.map(item => { const active = path === item.path || (path.startsWith("/leads/") && item.path === "/leads") || (path.startsWith("/calls/") && item.path === "/calls") || (path.startsWith("/conversations/") && item.path === "/conversations"); return <button key={item.path} onClick={() => { navigate(item.path); setMobileOpen(false); }} className={`nav-item ${active ? "active" : ""}`} title={collapsed ? item.label : undefined}><item.icon size={17} /><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}</button> })}</div>)}</nav>
      <div className="sidebar-bottom"><div className="status-mini"><span className="pulse-dot" /><span><b>All systems operational</b><small>Last checked just now</small></span></div><button className="profile-mini" onClick={() => navigate("/profile")}><span className="avatar">MS</span><span><b>Maya Singh</b><small>Admin · Acme Cargo</small></span><MoreHorizontal size={16} /></button></div>
    </aside>
    {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
    <main className="main-shell">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div className="topbar-title"><span>{meta.eyebrow}</span><h1>{meta.title}</h1></div><div className="topbar-actions"><GlobalSearch /><button className="icon-btn" onClick={() => navigate("/notifications")}><Bell size={18} /><i className="unread-dot" /></button><button className="top-avatar" onClick={() => navigate("/profile")}>MS</button></div></header>
      <div className="page-content">{children}</div>
    </main>
  </div>;
}
