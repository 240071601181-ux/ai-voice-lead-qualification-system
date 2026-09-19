import { useEffect, useState } from "react";
import {
  ChevronRight,
  Pause,
  Play,
} from "lucide-react";
import { AmbientShards, Button, Card } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { pageMeta } from "@/mock/pipeline";
import { useToast } from "@/layouts/AppLayout";
import {
  useAgentConfigQuery,
  useAgentHealthMetricsQuery,
  useAgentHealthQuery,
  usePauseAgentMutation,
  useResumeAgentMutation,
  useUpdateAgentConfigMutation,
} from "@/api/hooks/useAgentConfig";
import { getUserMessage } from "@/api/errors";
import type { AgentConfig, AgentConfigPatch } from "@/api/types";

type BehaviorKey = "greeting" | "qualificationQuestions" | "escalationBehavior" | "callEnding";

const BEHAVIOR_META: { key: BehaviorKey; label: string; hint: string }[] = [
  { key: "greeting", label: "Greeting", hint: "How the assistant opens the conversation." },
  { key: "qualificationQuestions", label: "Qualification questions", hint: "One question per line." },
  { key: "escalationBehavior", label: "Escalation behavior", hint: "When and how to hand off to a human." },
  { key: "callEnding", label: "Conversation ending", hint: "How the assistant closes the conversation." },
];

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  ta: "Tamil",
};

const truncate = (value: string, max = 64): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** Human duration for a seconds value (real measurement, never estimated). */
function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "N/A";
  if (value < 90) return `${Math.round(value)}s`;
  return `${(value / 60).toFixed(1)} min`;
}

function behaviorSummary(config: AgentConfig, key: BehaviorKey): string {
  switch (key) {
    case "greeting":
      return truncate(config.greeting);
    case "qualificationQuestions":
      return `${config.qualificationQuestions.length} question${config.qualificationQuestions.length === 1 ? "" : "s"} configured`;
    case "escalationBehavior":
      return truncate(config.escalationBehavior);
    case "callEnding":
      return truncate(config.callEnding);
  }
}

function behaviorDraft(config: AgentConfig, key: BehaviorKey): string {
  return key === "qualificationQuestions"
    ? config.qualificationQuestions.join("\n")
    : config[key];
}

function draftToValue(key: BehaviorKey, draft: string): string | string[] {
  if (key === "qualificationQuestions") {
    return draft
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return draft.trim();
}

/**
 * AI Agent page — operator view over the real backend agent configuration
 * (GET/PATCH /api/v1/agent/config, POST /pause + /resume, GET /health).
 *
 * Phase 14: the decorative voice orb, telephony status, and demo tool-access
 * list are retired with voice. What remains is generic conversation-assistant
 * management:
 * - Pause/resume persist backend-side (no local-only state).
 * - Health shows "--" / Unavailable: the backend collects no aggregate
 *   telemetry, so no demo percentages are presented as live metrics.
 * - Languages/voice render actual backend configuration values, marked as
 *   static backend configuration.
 */
function AIPage({ onToast }: { onToast: (message: string) => void }) {
  const configQuery = useAgentConfigQuery();
  const healthQuery = useAgentHealthQuery();
  const metricsQuery = useAgentHealthMetricsQuery();
  const updateMutation = useUpdateAgentConfigMutation();
  const pauseMutation = usePauseAgentMutation();
  const resumeMutation = useResumeAgentMutation();

  const config = configQuery.data;
  const paused = config?.paused ?? false;
  const pendingPause = pauseMutation.isPending || resumeMutation.isPending;

  const [editorKey, setEditorKey] = useState<BehaviorKey | null>(null);
  const [fullEditorOpen, setFullEditorOpen] = useState(false);

  const handlePauseResume = () => {
    if (!config || pendingPause) return;
    if (paused) {
      resumeMutation.mutate(undefined, {
        onSuccess: () => onToast("Agent resumed"),
        onError: (error) => onToast(`Could not resume agent: ${getUserMessage(error)}`),
      });
    } else {
      pauseMutation.mutate(undefined, {
        onSuccess: () => onToast("Agent paused"),
        onError: (error) => onToast(`Could not pause agent: ${getUserMessage(error)}`),
      });
    }
  };

  const statusLabel = paused ? "Agent paused" : "Active";
  const languages = (config?.languages ?? []).map((code) => LANGUAGE_NAMES[code] ?? code).join(" · ") || "—";

  return (
    <>
      <AmbientShards variant="agent" />
      <div className="page-heading">
        <div><p className="lede">{pageMeta["/ai-agent"].description}</p></div>
        <div className="heading-actions">
          <span className="agent-live"><i />{configQuery.isPending ? "Loading agent…" : statusLabel}</span>
          <Button
            icon={paused ? Play : Pause}
            variant={paused ? "primary" : "secondary"}
            onClick={handlePauseResume}
            disabled={!config || pendingPause}
          >
            {pendingPause ? "Working…" : paused ? "Resume agent" : "Pause agent"}
          </Button>
        </div>
      </div>
      <div className="ai-grid">
        <Card className="agent-visual">
          <div className="card-header">
            <div>
              <span className="section-kicker">TEXT ASSISTANT</span>
              <h2>{config ? `${config.name} ${config.version}` : "MadLead Qualifier v2.4"}</h2>
            </div>
            <span className={`status-chip ${paused ? "status-abandoned" : "status-active"}`}>
              {configQuery.isPending ? "Loading…" : paused ? "Paused" : "Active"}
            </span>
          </div>
          <p className="lede" style={{ textAlign: "center" }}>
            {paused
              ? "Agent is paused. Resume to handle conversations again."
              : "Handling text conversations. Pause to stop new replies."}
          </p>
          <div className="agent-stats">
            <span><small>LANGUAGE</small><b>{configQuery.isPending ? "Loading…" : languages}</b></span>
            <span><small>VOICE</small><b>{configQuery.isPending ? "Loading…" : config?.voice ?? "—"}</b></span>
          </div>
          <p className="lede" style={{ textAlign: "center" }}>
            Languages and voice are static backend configuration.
          </p>
        </Card>
        <Card className="config-card">
          <div className="card-header">
            <div><span className="section-kicker">CONFIGURATION</span><h2>Conversation behavior</h2></div>
          </div>
          <div className="config-list">
            {configQuery.isPending ? (
              <div><span>Loading configuration…</span></div>
            ) : configQuery.isError || !config ? (
              <div>
                <span>Couldn&apos;t load configuration: {getUserMessage(configQuery.error)}</span>
                <button className="filter-select" onClick={() => { void configQuery.refetch(); }}>Retry</button>
              </div>
            ) : (
              BEHAVIOR_META.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEditorKey(key)}
                  style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, background: "none", border: "none", borderBottom: "1px solid var(--line-soft)", padding: "13px 0", cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit" }}
                >
                  <span>{label}</span>
                  <b style={{ flex: 1 }}>{behaviorSummary(config, key)}</b>
                  <ChevronRight size={15} />
                </button>
              ))
            )}
          </div>
          <Button
            variant="secondary"
            className="full-btn"
            onClick={() => setFullEditorOpen(true)}
            disabled={!config}
          >
            Edit configuration
          </Button>
        </Card>
        <Card className="performance-card">
          <div className="card-header">
            <div><span className="section-kicker">PERFORMANCE</span><h2>Agent health</h2></div>
            <span className="health-badge">
              {healthQuery.isPending ? "Checking…" : paused ? "Paused" : "Active"}
            </span>
          </div>
          <div className="performance-grid">
            <div>
              <strong>{metricsQuery.isPending ? "…" : metricsQuery.data ? String(metricsQuery.data.textConversations.total) : "N/A"}</strong>
              <span>Text conversations</span>
            </div>
            <div>
              <strong>{metricsQuery.isPending ? "…" : metricsQuery.data?.qualification.ratePercent != null ? `${metricsQuery.data.qualification.ratePercent}%` : "N/A"}</strong>
              <span>Qualification rate</span>
            </div>
            <div>
              <strong>N/A</strong>
              <span>Conversation quality</span>
            </div>
            <div>
              <strong>{metricsQuery.isPending ? "…" : metricsQuery.data?.responsiveness.avgFirstResponseSec != null ? formatSeconds(metricsQuery.data.responsiveness.avgFirstResponseSec) : "N/A"}</strong>
              <span>Avg. first response</span>
            </div>
          </div>
          <p className="lede">
            {metricsQuery.isPending
              ? "Loading metrics…"
              : metricsQuery.isError || !metricsQuery.data
                ? "Metrics unavailable — showing N/A instead of estimates."
                : `Live from the database: ${metricsQuery.data.textConversations.total} conversations (${metricsQuery.data.textConversations.active} active) · ${metricsQuery.data.qualification.qualifiedConversations} of ${metricsQuery.data.qualification.totalConversations} qualified · first response measured over ${metricsQuery.data.responsiveness.conversationsMeasured} conversation(s). No deterministic quality metric exists.`}
          </p>
        </Card>
      </div>
      {config ? (
        <BehaviorEditorDialog
          config={config}
          fieldKey={editorKey}
          onOpenChange={(open) => { if (!open) setEditorKey(null); }}
          onToast={onToast}
        />
      ) : null}
      {config ? (
        <FullConfigDialog
          config={config}
          open={fullEditorOpen}
          onOpenChange={setFullEditorOpen}
          onToast={onToast}
        />
      ) : null}
    </>
  );
}

/** Single-field editor: view + edit one conversation behavior. Save persists
 * via PATCH; Cancel/close discards the draft. */
function BehaviorEditorDialog({
  config,
  fieldKey,
  onOpenChange,
  onToast,
}: {
  config: AgentConfig;
  fieldKey: BehaviorKey | null;
  onOpenChange: (open: boolean) => void;
  onToast: (message: string) => void;
}) {
  const updateMutation = useUpdateAgentConfigMutation();
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (fieldKey) {
      setDraft(behaviorDraft(config, fieldKey));
      setSaveError(null);
      updateMutation.reset();
    }
    // Reset the draft every time a field editor opens; config identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKey]);

  const meta = BEHAVIOR_META.find((b) => b.key === fieldKey);
  const open = fieldKey !== null;

  const handleSave = () => {
    if (!fieldKey || updateMutation.isPending) return;
    const value = draftToValue(fieldKey, draft);
    if (typeof value === "string" ? value.length === 0 : value.length === 0) {
      setSaveError("Enter a value before saving.");
      return;
    }
    setSaveError(null);
    const patch: AgentConfigPatch =
      fieldKey === "qualificationQuestions"
        ? { qualificationQuestions: value as string[] }
        : { [fieldKey]: value as string };
    updateMutation.mutate(patch, {
      onSuccess: () => {
        onToast(`${meta?.label ?? "Configuration"} saved`);
        onOpenChange(false);
      },
      onError: (error) => setSaveError(getUserMessage(error)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>{meta ? `Edit ${meta.label.toLowerCase()}` : "Edit behavior"}</DialogTitle>
          <DialogDescription>
            {meta?.hint ?? "Update the agent configuration."} Save persists to the backend; cancel discards your changes.
          </DialogDescription>
        </DialogHeader>
        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
          {meta?.label ?? "Value"}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={fieldKey === "qualificationQuestions" ? 8 : 4}
            disabled={updateMutation.isPending}
            style={{ width: "100%", resize: "vertical" }}
          />
        </label>
        {saveError ? <small style={{ color: "#f87171", fontSize: 11 }}>{saveError}</small> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Full editor: all conversation behavior fields in one panel. */
function FullConfigDialog({
  config,
  open,
  onOpenChange,
  onToast,
}: {
  config: AgentConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToast: (message: string) => void;
}) {
  const updateMutation = useUpdateAgentConfigMutation();
  const [greeting, setGreeting] = useState(config.greeting);
  const [questions, setQuestions] = useState(config.qualificationQuestions.join("\n"));
  const [escalation, setEscalation] = useState(config.escalationBehavior);
  const [ending, setEnding] = useState(config.callEnding);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setGreeting(config.greeting);
      setQuestions(config.qualificationQuestions.join("\n"));
      setEscalation(config.escalationBehavior);
      setEnding(config.callEnding);
      setSaveError(null);
      updateMutation.reset();
    }
    // Refresh drafts from saved values on every open so cancel discards edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSave = () => {
    if (updateMutation.isPending) return;
    const questionList = questions.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    if (!greeting.trim() || questionList.length === 0 || !escalation.trim() || !ending.trim()) {
      setSaveError("All fields are required; add at least one qualification question.");
      return;
    }
    setSaveError(null);
    updateMutation.mutate(
      {
        greeting: greeting.trim(),
        qualificationQuestions: questionList,
        escalationBehavior: escalation.trim(),
        callEnding: ending.trim(),
      },
      {
        onSuccess: () => {
          onToast("Agent configuration saved");
          onOpenChange(false);
        },
        onError: (error) => setSaveError(getUserMessage(error)),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>Edit agent configuration</DialogTitle>
          <DialogDescription>
            Update the conversation behavior below. Save persists every field to the backend; cancel discards your changes.
          </DialogDescription>
        </DialogHeader>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            Greeting
            <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={3} disabled={updateMutation.isPending} style={{ width: "100%", resize: "vertical" }} />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            Qualification questions (one per line)
            <textarea value={questions} onChange={(e) => setQuestions(e.target.value)} rows={6} disabled={updateMutation.isPending} style={{ width: "100%", resize: "vertical" }} />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            Escalation behavior
            <textarea value={escalation} onChange={(e) => setEscalation(e.target.value)} rows={3} disabled={updateMutation.isPending} style={{ width: "100%", resize: "vertical" }} />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            Call ending
            <textarea value={ending} onChange={(e) => setEnding(e.target.value)} rows={3} disabled={updateMutation.isPending} style={{ width: "100%", resize: "vertical" }} />
          </label>
        </div>
        {saveError ? <small style={{ color: "#f87171", fontSize: 11 }}>{saveError}</small> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving…" : "Save configuration"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AiAgentPage() {
  const { notify } = useToast();
  return <AIPage onToast={notify} />;
}
