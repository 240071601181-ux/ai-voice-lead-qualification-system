import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { AmbientShards, Button, Logo } from "@/components/app/ui";

/** Demo-only: sets the new password locally, no backend call. */
export default function ResetPasswordPage() {
  const [, navigate] = useLocation();
  const [show, setShow] = useState(false);
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
          <span className="section-kicker">SECURE ACCESS</span>
          <h2>Choose a new password</h2>
          <p>Enter and confirm the password for your workspace account.</p>
          <label>New password
            <div className="password-field">
              <input type={show ? "text" : "password"} placeholder="Enter your new password" />
              <button onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
            </div>
          </label>
          <label>Confirm password
            <div className="password-field">
              <input type={show ? "text" : "password"} placeholder="Repeat your new password" />
            </div>
          </label>
          <Button variant="primary" className="auth-submit" onClick={() => navigate("/login")}>
            Set new password<ArrowUpRight size={15} />
          </Button>
          <div className="auth-footer">
            <button onClick={() => navigate("/login")}>Back to sign in</button>
          </div>
          <small className="legal-copy">By continuing, you agree to MadVoice AI’s Terms of Service and Privacy Policy.</small>
        </div>
      </div>
    </div>
  );
}
