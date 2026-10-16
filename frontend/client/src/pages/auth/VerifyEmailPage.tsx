import { useLocation } from "wouter";
import { CheckCircle2 } from "lucide-react";
import { AmbientShards, Logo } from "@/components/app/ui";

/** Compatibility page for old links; this product does not require email verification. */
export default function VerifyEmailPage() {
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
          <span className="section-kicker">ACCOUNT STATUS</span>
          <h2>Email verification is not required</h2>
          <p>Accounts can use MadLead AI immediately after registration. This deployment does not send or validate verification emails.</p>
          <div className="auth-footer"><button type="button" onClick={() => navigate("/login")}>Back to sign in</button></div>
        </div>
      </div>
    </div>
  );
}
