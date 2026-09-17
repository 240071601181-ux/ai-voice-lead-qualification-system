import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { IntegrationDiagnosticCheck } from "@/api/types";

/** Real diagnostic checks rendered verbatim (Overall + per-check status). */
export function ChecksList({ checks }: { checks: IntegrationDiagnosticCheck[] }) {
  return (
    <div className="detail-fields">
      {checks.map((check) => (
        <div key={check.name}>
          <span>{check.name}</span>
          <b>
            {check.status === "ok" ? "OK" : check.status === "skipped" ? "Skipped" : "Failed"} — {check.message}
          </b>
        </div>
      ))}
    </div>
  );
}

/** Pager for real paginated inventories (same styling as follow-ups). */
export function Pager({
  page,
  totalPages,
  total,
  itemLabel,
  pending,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  itemLabel: string;
  pending: boolean;
  onPage: (page: number) => void;
}) {
  const window: number[] = [];
  const start = Math.max(1, Math.min(page - 1, totalPages - 2));
  const end = Math.min(totalPages, start + 2);
  for (let p = start; p <= end; p++) window.push(p);
  if (total <= 0) return null;
  return (
    <div className="table-footer">
      <span>Showing <b>{itemLabel}</b> of {total}</span>
      <div className="pagination">
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1 || pending}>
          <ChevronLeft size={14} />
        </button>
        {window.map((p) => (
          <button key={p} className={p === page ? "current" : ""} onClick={() => onPage(p)} disabled={pending}>
            {p}
          </button>
        ))}
        {totalPages > 3 && window[window.length - 1] < totalPages && (
          <>
            <span>…</span>
            <button onClick={() => onPage(totalPages)} disabled={pending}>{totalPages}</button>
          </>
        )}
        <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages || pending}>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

/** Generic status dialog shell — always has Title + Description. */
export function StatusDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {actions}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button variant="ghost" onClick={onClose}>
      Close
    </Button>
  );
}
