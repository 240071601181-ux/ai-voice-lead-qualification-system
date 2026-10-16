import { useLocation } from "wouter";
import { CheckCircle2 } from "lucide-react";
import { AmbientShards, Logo } from "@/components/app/ui";

/** Kept for old reset links; no reset tokens are issued until email delivery exists. */
export default function ResetPasswordPage() {
  const [, navigate] = useLocation();
  return (
    <div className="auth-screen">
      <div className="auth-aside">
        <AmbientShards variant="auth" />
        <Logo />
        <div className="auth-aside-copy">
          <span className="section-kicker">AI-POWERED LOGISTICS OPS</span>
          <h1>Qualify conversations.<br /><em>Move logistics forward.</em></h1>
          <p>MadLead AI turns every logistics conversation into a qualified, actionable next step.</p>
        </div>
        <div className="auth-proof"><span><CheckCircle2 size={15} />AI qualification in real time</span><span><CheckCircle2 size={15} />Built for freight operations</span></div>
      </div>
      <div className="auth-panel">
        <div className="auth-form">
          <button type="button" className="auth-mobile-logo" onClick={() => navigate("/login")} aria-label="Back to sign in"><Logo /></button>
          <span className="section-kicker">SECURE ACCESS</span>
          <h2>Password reset unavailable</h2>
          <p>This deployment cannot issue or validate password reset links because no email delivery provider is configured.</p>
          <p className="panel-note">Contact your administrator for help. No password has been changed.</p>
          <div className="auth-footer"><button type="button" onClick={() => navigate("/login")}>Back to sign in</button></div>
        </div>
      </div>
    </div>
  );
}
