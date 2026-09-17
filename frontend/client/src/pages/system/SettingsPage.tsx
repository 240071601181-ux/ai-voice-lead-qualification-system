import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Bell,
  Bot,
  Check,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  UserCircle2,
  Users,
} from "lucide-react";
import { Button, Card } from "@/components/app/ui";
import { pageMeta } from "@/mock/pipeline";
import { useToast } from "@/layouts/AppLayout";
import { useLogoutMutation } from "@/api/hooks/useSession";
import {
  useUpdateWorkspaceSettingsMutation,
  useWorkspaceSettingsQuery,
} from "@/api/hooks/useSettings";
import { getUserMessage } from "@/api/errors";
import type { WorkspaceSettings } from "@/api/types";

type SettingsTab =
  | "profile"
  | "organization"
  | "ai-agent"
  | "notifications"
  | "integrations"
  | "security"
  | "appearance";

const TABS: { key: SettingsTab; label: string; icon: typeof Bell }[] = [
  { key: "profile", label: "Profile", icon: UserCircle2 },
  { key: "organization", label: "Organization", icon: Users },
  { key: "ai-agent", label: "AI agent", icon: Bot },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "integrations", label: "Integrations", icon: Network },
  { key: "security", label: "Security", icon: ShieldCheck },
  { key: "appearance", label: "Appearance", icon: SlidersHorizontal },
];

interface SettingsDraft {
  workspace_name: string;
  timezone: string;
  default_language: string;
  lead_score_threshold: string;
  notify_hot_lead: boolean;
  notify_integration_failure: boolean;
  notify_followup_due: boolean;
  notify_daily_digest: boolean;
}

type NotificationKey = "notify_hot_lead" | "notify_integration_failure" | "notify_followup_due" | "notify_daily_digest";

const toDraft = (settings: WorkspaceSettings): SettingsDraft => ({
  workspace_name: settings.workspace_name,
  timezone: settings.timezone,
  default_language: settings.default_language,
  lead_score_threshold: String(settings.lead_score_threshold),
  notify_hot_lead: settings.notify_hot_lead,
  notify_integration_failure: settings.notify_integration_failure,
  notify_followup_due: settings.notify_followup_due,
  notify_daily_digest: settings.notify_daily_digest,
});

const NOTIFICATION_ROWS: {
  key: NotificationKey;
  label: string;
  hint: string;
}[] = [
  { key: "notify_hot_lead", label: "Hot lead qualified", hint: "Notify me when a lead crosses the HOT threshold" },
  { key: "notify_integration_failure", label: "Integration failure", hint: "Alert me when a connected service needs attention" },
  { key: "notify_followup_due", label: "Follow-up due", hint: "Keep the next best action visible" },
  { key: "notify_daily_digest", label: "Daily operations digest", hint: "Receive a summary at 6:00 PM local time" },
];

const INTEGRATION_LINKS: { label: string; hint: string; path: string }[] = [
  { label: "CRM sync", hint: "Provider status, sync history, diagnostics", path: "/crm" },
  { label: "WhatsApp messaging", hint: "Delivery status, templates, consent mode", path: "/whatsapp" },
  { label: "Calendar workspace", hint: "Bookings, sync status, diagnostics", path: "/calendar" },
  { label: "Automation center", hint: "Configured workflows, delivery status", path: "/automation" },
  { label: "Knowledge base", hint: "Documents, search, store health", path: "/knowledge" },
];

/**
 * Settings page — every control is backed by the persisted workspace
 * settings row (GET/PATCH /api/v1/settings) or by a real navigation /
 * session action:
 *
 * - Profile fields load from the backend and save via PATCH (Saving… →
 *   success/error, refetch after save). Reset discards unsaved edits back
 *   to the saved values.
 * - Notification toggles persist IMMEDIATELY on click (PATCH one field,
 *   rollback + safe error on failure), so navigate-away/refresh preserves
 *   them without requiring Save.
 * - Organization mirrors the same persisted row (read-only) with a truthful
 *   "member management coming later" note.
 * - AI agent / Integrations navigate to the real pages. Security signs out
 *   the demo session (same mechanism as Profile). Appearance and member
 *   management show honest "Coming later" states — no fake toggles, no
 *   silent buttons, no fake success.
 */
function SettingsPage({ onToast }: { onToast: (message: string) => void }) {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<SettingsTab>("profile");
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [togglePending, setTogglePending] = useState<string | null>(null);

  const settingsQuery = useWorkspaceSettingsQuery();
  const updateMutation = useUpdateWorkspaceSettingsMutation();
  const settings = settingsQuery.data;

  useEffect(() => {
    if (settingsQuery.data) {
      setDraft((current) => current ?? toDraft(settingsQuery.data as WorkspaceSettings));
    }
  }, [settingsQuery.data]);

  const pristine =
    !draft ||
    !settings ||
    (draft.workspace_name === settings.workspace_name &&
      draft.timezone === settings.timezone &&
      draft.default_language === settings.default_language &&
      draft.lead_score_threshold === String(settings.lead_score_threshold));

  const handleSave = () => {
    if (!draft || updateMutation.isPending) return;
    const threshold = draft.lead_score_threshold.trim() === "" ? NaN : Number(draft.lead_score_threshold);
    if (!draft.workspace_name.trim()) {
      setFieldError("Workspace name is required.");
      return;
    }
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
      setFieldError("Lead score threshold must be an integer between 0 and 100.");
      return;
    }
    setFieldError(null);
    setSaveError(null);
    updateMutation.mutate(
      {
        workspace_name: draft.workspace_name.trim(),
        timezone: draft.timezone,
        default_language: draft.default_language,
        lead_score_threshold: threshold,
      },
      {
        onSuccess: () => onToast("Settings saved successfully"),
        onError: (error) => setSaveError(getUserMessage(error)),
      }
    );
  };

  const handleReset = () => {
    if (!settings) return;
    setDraft(toDraft(settings));
    setFieldError(null);
    setSaveError(null);
    onToast("Unsaved changes discarded");
  };

  const handleToggle = (key: NotificationKey) => {
    if (!settings || !draft || togglePending) return;
    const next = !draft[key];
    const previous = draft;
    setDraft({ ...draft, [key]: next });
    setTogglePending(key);
    updateMutation.mutate(
      { [key]: next },
      {
        onSuccess: () => {
          setTogglePending(null);
          onToast("Notification preference saved");
        },
        onError: (error) => {
          setDraft(previous);
          setTogglePending(null);
          onToast(`Could not save preference: ${getUserMessage(error)}`);
        },
      }
    );
  };

  const logout = useLogoutMutation();
  const handleSignOut = () => {
    logout.mutate(undefined, {
      onSettled: () => navigate("/login"),
    });
  };

  const notifyValue = (key: NotificationKey): boolean =>
    draft ? draft[key] : (settings?.[key] ?? false);

  return (
    <>
      <div className="page-heading">
        <div><p className="lede">{pageMeta["/settings"].description}</p></div>
        <div className="heading-actions">
          <Button variant="ghost" onClick={handleReset} disabled={!settings || pristine || updateMutation.isPending}>
            Reset
          </Button>
          <Button
            icon={Check}
            variant="primary"
            onClick={handleSave}
            disabled={!settings || pristine || updateMutation.isPending}
          >
            {updateMutation.isPending && !togglePending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
      <div className="settings-layout">
        <Card className="settings-nav">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
              <Icon size={16} />{label}
            </button>
          ))}
        </Card>
        <Card className="settings-form">
          {settingsQuery.isPending || !draft || !settings ? (
            settingsQuery.isError ? (
              <div className="settings-section">
                <span className="section-kicker">SETTINGS</span>
                <h2>Couldn&apos;t load settings</h2>
                <p>{getUserMessage(settingsQuery.error)}</p>
                <div style={{ marginTop: 12 }}>
                  <Button variant="secondary" onClick={() => { void settingsQuery.refetch(); }}>Retry</Button>
                </div>
              </div>
            ) : (
              <div className="settings-section">
                <span className="section-kicker">SETTINGS</span>
                <h2>Loading settings…</h2>
                <p>Reading the persisted workspace settings.</p>
              </div>
            )
          ) : (
            <>
              {tab === "profile" ? (
                <div className="settings-section">
                  <span className="section-kicker">PROFILE</span>
                  <h2>Workspace defaults</h2>
                  <p>These settings apply to your operations workspace and default agent behavior.</p>
                  <div className="form-grid">
                    <label>
                      Workspace name
                      <input
                        value={draft.workspace_name}
                        onChange={(e) => { setDraft({ ...draft, workspace_name: e.target.value }); setFieldError(null); }}
                      />
                    </label>
                    <label>
                      Timezone
                      <select value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>
                        <option value="Asia/Kolkata">Asia / Kolkata (IST)</option>
                        <option value="UTC">UTC</option>
                      </select>
                    </label>
                    <label>
                      Default language
                      <select value={draft.default_language} onChange={(e) => setDraft({ ...draft, default_language: e.target.value })}>
                        <option>English</option>
                        <option>Hindi</option>
                        <option>Tamil</option>
                      </select>
                    </label>
                    <label>
                      Lead score threshold
                      <input
                        value={draft.lead_score_threshold}
                        onChange={(e) => { setDraft({ ...draft, lead_score_threshold: e.target.value }); setFieldError(null); }}
                        inputMode="numeric"
                      />
                    </label>
                  </div>
                  {fieldError ? <p style={{ color: "#f87171", fontSize: 10, marginTop: 12 }}>{fieldError}</p> : null}
                  {saveError ? (
                    <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ color: "#f87171", fontSize: 11 }}>{saveError}</span>
                      <Button variant="secondary" onClick={handleSave} disabled={updateMutation.isPending}>Retry</Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === "organization" ? (
                <div className="settings-section">
                  <span className="section-kicker">ORGANIZATION</span>
                  <h2>{settings.workspace_name}</h2>
                  <p>Workspace identity, persisted with the profile settings.</p>
                  <div className="form-grid">
                    <label>Workspace name<input value={settings.workspace_name} readOnly /></label>
                    <label>Timezone<input value={settings.timezone} readOnly /></label>
                    <label>Default language<input value={settings.default_language} readOnly /></label>
                    <label>Lead score threshold<input value={String(settings.lead_score_threshold)} readOnly /></label>
                  </div>
                  <p style={{ marginTop: 12 }}>Member management and roles — Coming later.</p>
                </div>
              ) : null}

              {tab === "ai-agent" ? (
                <div className="settings-section">
                  <span className="section-kicker">AI AGENT</span>
                  <h2>Voice agent configuration</h2>
                  <p>Greeting, qualification questions, escalation, call ending, and pause state live on the AI Agent page.</p>
                  <div style={{ marginTop: 12 }}>
                    <Button icon={Bot} variant="primary" onClick={() => navigate("/ai-agent")}>
                      Open AI agent configuration
                    </Button>
                  </div>
                </div>
              ) : null}

              {tab === "notifications" ? (
                <div className="settings-section">
                  <span className="section-kicker">NOTIFICATIONS</span>
                  <h2>Operational alerts</h2>
                  <p>Choose which signals should interrupt your day. Changes save immediately.</p>
                  {NOTIFICATION_ROWS.map(({ key, label, hint }) => (
                    <div className="toggle-row" key={key}>
                      <span><b>{label}</b><small>{hint}</small></span>
                      <button
                        className={`toggle ${notifyValue(key) ? "on" : "off"}`}
                        onClick={() => handleToggle(key)}
                        disabled={togglePending === key}
                        aria-pressed={notifyValue(key)}
                        aria-label={label}
                      >
                        <i />
                      </button>
                    </div>
                  ))}
                  {togglePending ? <p style={{ fontSize: 10, marginTop: 8 }}>Saving…</p> : null}
                </div>
              ) : null}

              {tab === "integrations" ? (
                <div className="settings-section">
                  <span className="section-kicker">INTEGRATIONS</span>
                  <h2>Connected services</h2>
                  <p>Each service has its own status, diagnostics, and history page.</p>
                  {INTEGRATION_LINKS.map(({ label, hint, path }) => (
                    <div className="toggle-row" key={path}>
                      <span><b>{label}</b><small>{hint}</small></span>
                      <Button variant="secondary" onClick={() => navigate(path)}>Open</Button>
                    </div>
                  ))}
                </div>
              ) : null}

              {tab === "security" ? (
                <div className="settings-section">
                  <span className="section-kicker">SECURITY</span>
                  <h2>Session</h2>
                  <p>Signed in to the demo workspace on this device. Advanced controls (SSO, 2FA) — Coming later.</p>
                  <div style={{ marginTop: 12 }}>
                    <Button icon={ShieldCheck} variant="secondary" onClick={handleSignOut}>
                      Sign out
                    </Button>
                  </div>
                </div>
              ) : null}

              {tab === "appearance" ? (
                <div className="settings-section">
                  <span className="section-kicker">APPEARANCE</span>
                  <h2>Theme</h2>
                  <p>Theme switching — Coming later. The workspace uses the default theme.</p>
                </div>
              ) : null}
            </>
          )}
        </Card>
      </div>
    </>
  );
}

export default function SettingsPageRoute() {
  const { notify } = useToast();
  return <SettingsPage onToast={notify} />;
}
