import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button, Card } from "@/components/app/ui";
import { useCalendarDiagnosticsQuery } from "@/api/hooks/useCalendar";
import { getUserMessage } from "@/api/errors";

const dialogStyle: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(480px, calc(100vw - 32px))",
  maxHeight: "calc(100vh - 48px)",
  overflowY: "auto",
  zIndex: 50,
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.6)",
  zIndex: 40,
};

/**
 * Real Calendar configuration status (calendar page only).
 *
 * Every value comes from GET /api/v1/calendar/diagnostics — the backend
 * reports feature flags and credential *presence* only, so no secret is
 * ever exposed or faked here. OAuth can only be connected through backend
 * environment configuration, which this dialog explains.
 */
export function CalendarConfigDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const diagnostics = useCalendarDiagnosticsQuery({ enabled: open });
  const check = (name: string) => diagnostics.data?.checks.find((c) => c.name === name);
  const enabled = check("enabled");
  const provider = check("provider");
  const connectivity = check("connectivity");
  const connected = connectivity?.status === "ok";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content style={dialogStyle} aria-label="Calendar configuration" aria-describedby="calendar-config-desc">
          <Dialog.Description id="calendar-config-desc" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
            View calendar connection status and what is required to enable Calendar.
          </Dialog.Description>
          <Card className="tab-panel">
            <div className="card-header">
              <div><span className="section-kicker">CALENDAR CONFIGURATION</span><Dialog.Title asChild><h2>Calendar configuration</h2></Dialog.Title></div>
              <button className="more-btn" onClick={() => onOpenChange(false)}><X size={16} /></button>
            </div>
            {diagnostics.isPending ? (
              <span style={{ fontSize: 12, color: "#8190a1" }}>Loading configuration…</span>
            ) : diagnostics.isError ? (
              <span style={{ fontSize: 12, color: "#f87171" }}>
                Couldn&apos;t load configuration: {getUserMessage(diagnostics.error)}{" "}
                <Button variant="secondary" onClick={() => { void diagnostics.refetch(); }}>Retry</Button>
              </span>
            ) : (
              <div className="detail-fields">
                <div><span>Calendar enabled</span><b>{enabled?.status === "ok" ? "Enabled" : "Disabled"}</b></div>
                <div><span>Provider</span><b>{provider?.message ?? "—"}</b></div>
                <div><span>Google Calendar</span><b>{connected ? "Connected" : "Not connected"}</b></div>
                <div><span>Connectivity</span><b>{connectivity?.message ?? "—"}</b></div>
              </div>
            )}
            <div className="card-header" style={{ marginTop: 14 }}>
              <div><span className="section-kicker">REQUIREMENTS</span><h2>What is required to enable Calendar</h2></div>
            </div>
            <div className="message-log" style={{ fontSize: 11, color: "#8190a1" }}>
              <div className="log-line"><span className="log-dot" /><div><b>Set CALENDAR_ENABLED=true in backend environment.</b></div></div>
              <div className="log-line"><span className="log-dot" /><div><b>Provide Google OAuth credentials: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_ID.</b></div></div>
              <div className="log-line"><span className="log-dot" /><div><b>Restart the backend so environment changes apply.</b></div></div>
              <div className="log-line"><span className="log-dot" /><div><b>Secrets stay in backend environment only and are never displayed here.</b></div></div>
            </div>
            <div className="heading-actions" style={{ marginTop: 18 }}>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </Card>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
