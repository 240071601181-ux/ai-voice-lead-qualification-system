import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/app/ui";
import { LeadPicker } from "@/components/app/LeadPicker";
import { useStartCallMutation } from "@/api/hooks/useCalls";
import { getStartCallErrorMessage } from "@/api/errors";

/**
 * "Start AI Call" lead picker for the Calls page.
 *
 * The user must select an existing REAL lead (shared LeadPicker, live
 * GET /api/v1/leads) before starting. Initiation reuses the shared
 * useStartCallMutation hook → POST /api/v1/calls/start — the same real
 * Vapi flow as Lead Details. No second endpoint, no faked success: the
 * real backend/Vapi result (or its safe error, e.g. telephony
 * unconfigured) is shown inline.
 */
export function StartAiCallDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const startCall = useStartCallMutation();

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setNotice(null);
      startCall.reset();
    }
    // Reset dialog state on close only; startCall identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const busy = startCall.isPending;

  const handleStart = () => {
    if (busy) return;
    if (!selectedId) {
      setNotice("Select a lead to call.");
      return;
    }
    setNotice(null);
    startCall.mutate({ leadId: selectedId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Start AI call</DialogTitle>
        <DialogDescription>Choose an existing lead to call</DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden">
        <div className="card-header">
          <div>
            <span className="section-kicker">OUTBOUND CALL</span>
            <h2>Start AI call</h2>
          </div>
        </div>
        <LeadPicker
          value={selectedId}
          onChange={(id) => { setSelectedId(id); setNotice(null); }}
          disabled={busy}
        />
        {notice ? <small style={{ color: "#f87171", fontSize: 11 }}>{notice}</small> : null}
        {startCall.isSuccess && startCall.data ? (
          <small style={{ fontSize: 11, color: "#34d399" }}>
            Call started · {startCall.data.status} · {startCall.data.vapiCallId}
          </small>
        ) : null}
        {startCall.isError ? (
          <small style={{ fontSize: 11, color: "#f87171" }}>{getStartCallErrorMessage(startCall.error)}</small>
        ) : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Button icon={Phone} variant="primary" onClick={handleStart} disabled={busy}>
            {busy ? "Initiating…" : "Start call"}
          </Button>
          {startCall.isError && !busy ? (
            <Button variant="secondary" onClick={handleStart} disabled={!selectedId}>Retry</Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
