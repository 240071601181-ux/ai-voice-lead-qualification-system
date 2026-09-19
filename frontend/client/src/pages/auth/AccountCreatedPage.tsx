import { useLocation } from "wouter";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { AmbientShards, Button, Logo } from "@/components/app/ui";

/** Demo-only success state after signup. */
export default function AccountCreatedPage() {
  const [, navigate] = useLocation();
  return (
    <div className="auth-screen">
      <div className="auth-aside">
        <AmbientShards variant="auth" />
        <Logo />
        <div className="auth-aside-copy">
          <span className="section-kicker">AI-POWERED LOGISTICS OPS</span>
          <h1>Qualify conversations.<br /><em>Move logistics forward.</em></h1>
          <p>MadVoice AI turns every logistics conversation into a qualified, actionable next step.</p>
        </div>
        <div className="auth-proof">
          <span><CheckCircle2 size={15} />AI qualification in real time</span>
          <span><CheckCircle2 size={15} />Built for freight operations</span>
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-form">
          <button className="auth-mobile-logo" onClick={() => navigate("/dashboard")}><Logo /></button>
          <span className="section-kicker">GET STARTED</span>
          <h2>Workspace created</h2>
          <p>Your operations workspace is ready. Verify your email to unlock the pipeline.</p>
          <Button variant="primary" className="auth-submit" onClick={() => navigate("/verify-email")}>
            Continue to verification<ArrowUpRight size={15} />
          </Button>
          <div className="auth-footer">
            <button onClick={() => navigate("/dashboard")}>Skip for now</button>
          </div>
          <small className="legal-copy">By continuing, you agree to MadVoice AI’s Terms of Service and Privacy Policy.</small>
        </div>
      </div>
    </div>
  );
}
