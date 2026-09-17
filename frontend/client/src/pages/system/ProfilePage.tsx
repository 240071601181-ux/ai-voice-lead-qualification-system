import { useState } from "react";
import { useLocation } from "wouter";
import { Check, LogOut, MoreHorizontal } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button, Card } from "@/components/app/ui";
import { useToast } from "@/layouts/AppLayout";
import { demoLogout } from "@/app/demoAuth";

/** Demo-only profile. Save shows a toast; no backend call. */
export default function ProfilePage() {
  const { notify } = useToast();
  const [, navigate] = useLocation();
  const [logoutOpen, setLogoutOpen] = useState(false);

  const handleLogout = () => {
    setLogoutOpen(false);
    // Phase 14C-AUTH-FIX: actually clear the demo session so refresh cannot
    // restore it, then land on /login.
    demoLogout();
    navigate("/login");
  };
  return (
    <>
      <div className="page-heading">
        <div><p className="lede">Manage your identity and workspace details.</p></div>
        <div className="heading-actions">
          <Button icon={Check} variant="primary" onClick={() => notify("Profile saved")}>Save changes</Button>
        </div>
      </div>
      <Card className="lead-hero">
        <div className="lead-hero-main">
          <span className="avatar" style={{ width: 48, height: 48, fontSize: 14 }}>MS</span>
          <div>
            <div className="hero-name-row"><h2>Maya Singh</h2></div>
            <p>Admin <span>•</span> Acme Cargo <span>•</span> maya@acmecargo.in</p>
          </div>
        </div>
        <div className="hero-actions">
          <button className="icon-btn surface" onClick={() => notify("Profile actions opened")}><MoreHorizontal size={16} /></button>
          <Dialog.Root open={logoutOpen} onOpenChange={setLogoutOpen}>
            <Dialog.Trigger asChild>
              <button className="btn btn-secondary"><LogOut size={15} />Sign out</button>
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
                  <Dialog.Description asChild><p className="lede">You will be signed out of the MadVoice operations workspace on this device.</p></Dialog.Description>
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
      <Card className="settings-form" style={{ marginTop: 14 }}>
        <div className="settings-section">
          <span className="section-kicker">IDENTITY</span>
          <h2>Personal details</h2>
          <p>Changes are kept locally in this phase and are not sent anywhere.</p>
          <div className="form-grid">
            <label>Full name<input defaultValue="Maya Singh" /></label>
            <label>Work email<input defaultValue="maya@acmecargo.in" /></label>
            <label>Role<input defaultValue="Admin" /></label>
            <label>Workspace<input defaultValue="Acme Cargo" /></label>
          </div>
        </div>
      </Card>
    </>
  );
}
