import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Check, LogOut } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button, Card } from "@/components/app/ui";
import { useToast } from "@/layouts/AppLayout";
import { useLogoutMutation, useSessionQuery, useUpdateProfileMutation } from "@/api/hooks/useSession";
import { getUserMessage } from "@/api/errors";
import {
  ROLE_UNSET_COPY,
  WORKSPACE_UNSET_COPY,
  displayUserName,
  userInitials,
} from "@/components/app/userDisplay";

/**
 * Phase 17 — Profile over the real backend identity (GET /api/v1/auth/me
 * via useSessionQuery). Display name persists through PATCH /api/v1/auth/me
 * (name only); email is read-only; role/workspace have no backend columns
 * and render "Not set" instead of demo values. Sign-out revokes the
 * backend session.
 */
export default function ProfilePage() {
  const { notify } = useToast();
  const [, navigate] = useLocation();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const session = useSessionQuery();
  const logout = useLogoutMutation();
  const saveName = useUpdateProfileMutation();
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const user = session.data ?? null;
  const userName = displayUserName(user?.name);
  const userEmail = user?.email?.trim() || "—";
  const draft = nameDraft ?? user?.name?.trim() ?? "";
  const dirty = nameDraft !== null && nameDraft.trim() !== (user?.name?.trim() ?? "");

  useEffect(() => {
    // Reset the draft whenever fresh identity arrives (login/refresh/save).
    setNameDraft(null);
    saveName.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.name]);

  const handleSave = () => {
    if (saveName.isPending) return;
    const next = draft.trim();
    if (!next) {
      notify("Enter a display name before saving.");
      return;
    }
    saveName.mutate(next, {
      onSuccess: (updated) => notify(`Profile saved — hello, ${displayUserName(updated.name)}.`),
      onError: (error) => notify(getUserMessage(error)),
    });
  };

  const handleLogout = () => {
    setLogoutOpen(false);
    logout.mutate(undefined, {
      onSettled: () => navigate("/login"),
    });
  };

  return (
    <>
      <div className="page-heading">
        <div><p className="lede">Manage your identity and account.</p></div>
        <div className="heading-actions">
          <Button
            icon={Check}
            variant="primary"
            onClick={handleSave}
            disabled={!user || saveName.isPending || !dirty}
          >
            {saveName.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <Card className="profile-hero">
        {session.isPending ? (
          <div className="empty-state"><b>Loading profile…</b></div>
        ) : session.isError || !user ? (
          <div className="empty-state">
            <b>Couldn&apos;t load your profile</b>
            <span>{session.isError ? getUserMessage(session.error) : "You are signed out."}</span>
            <Button variant="secondary" onClick={() => { void session.refetch(); }}>Retry</Button>
          </div>
        ) : (
          <>
            <span className="avatar profile-avatar">{userInitials(user.name)}</span>
            <div className="profile-hero-main">
              <div className="hero-name-row"><h2 data-testid="profile-name">{userName}</h2></div>
              <p data-testid="profile-email">{userEmail}</p>
              <div className="conversation-meta">
                <span className="status-chip status-active">Active account</span>
              </div>
            </div>
            <div className="hero-actions">
              <Button
                variant="secondary"
                onClick={() => document.getElementById("profile-name-input")?.focus()}
              >
                Edit profile
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card className="settings-form profile-card">
        <div className="settings-section">
          <span className="section-kicker">IDENTITY</span>
          <h2>Personal details</h2>
          <p>Your display name is saved to your account. Email, role, and workspace cannot be changed here.</p>
          <div className="form-grid">
            <label>Full name
              <input
                id="profile-name-input"
                value={draft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Your display name"
                disabled={!user || saveName.isPending}
                maxLength={255}
              />
            </label>
            <label>Work email
              <input value={userEmail} disabled readOnly aria-readonly="true" />
            </label>
            <label>Role
              <input value={ROLE_UNSET_COPY} disabled readOnly aria-readonly="true" />
            </label>
            <label>Workspace
              <input value={WORKSPACE_UNSET_COPY} disabled readOnly aria-readonly="true" />
            </label>
          </div>
          {saveName.isError ? (
            <p className="panel-error">{getUserMessage(saveName.error)}</p>
          ) : null}
        </div>
      </Card>

      <Card className="settings-form profile-card">
        <div className="settings-section">
          <span className="section-kicker">ACCOUNT</span>
          <h2>Session</h2>
          <p>Signed in{userEmail !== "—" ? ` as ${userEmail}` : ""} on this device. Signing out revokes this session on the backend.</p>
          <Dialog.Root open={logoutOpen} onOpenChange={setLogoutOpen}>
            <Dialog.Trigger asChild>
              <Button variant="danger"><LogOut size={15} />Sign out</Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 40 }} />
              <Dialog.Content
                style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "min(400px, calc(100vw - 32px))", zIndex: 50 }}
                aria-label="Confirm sign out"
              >
                <Card className="tab-panel">
                  <div className="card-header">
                    <div><span className="section-kicker">SESSION</span><Dialog.Title asChild><h2>Sign out?</h2></Dialog.Title></div>
                  </div>
                  <Dialog.Description asChild><p className="lede">You will be signed out of the MadLead operations workspace on this device.</p></Dialog.Description>
                  <div className="heading-actions" style={{ marginTop: 18 }}>
                    <Button variant="ghost" onClick={() => setLogoutOpen(false)}>Stay signed in</Button>
                    <Button variant="danger" onClick={handleLogout}>Sign out</Button>
                  </div>
                </Card>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </Card>
    </>
  );
}
