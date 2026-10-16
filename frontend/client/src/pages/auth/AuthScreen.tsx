import { FormEvent, useState } from "react";
import { useLocation } from "wouter";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { AmbientShards, Button, Logo } from "@/components/app/ui";
import { useLoginMutation, useRegisterMutation } from "@/api/hooks/useSession";
import { ApiError, getUserMessage } from "@/api/errors";

/** First-party login and public USER registration. The backend session owns role assignment. */
export function AuthScreen({ mode }: { mode: string }) {
  const [, navigate] = useLocation();
  const [show, setShow] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const login = useLoginMutation();
  const register = useRegisterMutation();
  const pending = login.isPending || register.isPending;
  const isSignup = mode === "/signup";
  const isForgot = mode === "/forgot-password";
  const authErrorMessage = (error: unknown) =>
    error instanceof ApiError && error.kind === "unauthorized"
      ? "Invalid email or password."
      : getUserMessage(error);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setFormError(null);

    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setFormError("Enter a valid email address.");
      return;
    }
    if (isSignup && !fullName.trim()) {
      setFormError("Enter your full name to create an account.");
      return;
    }
    if (!password) {
      setFormError("Enter your password to continue.");
      return;
    }
    if (password.length > 128 || (isSignup && password.length < 8)) {
      setFormError(isSignup
        ? "Use a password between 8 and 128 characters."
        : "Your password must be 128 characters or fewer.");
      return;
    }

    if (isSignup) {
      register.mutate(
        { email: normalizedEmail, password, name: fullName.trim() },
        {
          // A successful response includes the backend-verified USER session.
          onSuccess: () => navigate("/dashboard"),
          onError: (error) => setFormError(authErrorMessage(error)),
        }
      );
      return;
    }

    login.mutate(
      { email: normalizedEmail, password },
      {
        // ADMIN and USER routing is determined only by the returned session.
        onSuccess: () => navigate("/dashboard"),
        onError: (error) => setFormError(authErrorMessage(error)),
      }
    );
  };

  const title = isSignup ? "Create your account" : isForgot ? "Password recovery unavailable" : "Welcome back to the signal";

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
        <div className="auth-proof">
          <span><CheckCircle2 size={15} />AI qualification in real time</span>
          <span><CheckCircle2 size={15} />Built for freight operations</span>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-form">
          <button type="button" className="auth-mobile-logo" onClick={() => navigate("/dashboard")} aria-label="Go to dashboard"><Logo /></button>
          <span className="section-kicker">{isSignup ? "GET STARTED" : "SECURE ACCESS"}</span>
          <h2>{title}</h2>

          {isForgot ? (
            <>
              <p>Password recovery email is not configured for this deployment, so a reset link cannot be sent.</p>
              <p className="panel-note">Contact your administrator to reset access. Email verification is not required to use an account.</p>
              <div className="auth-footer"><button type="button" onClick={() => navigate("/login")}>Back to sign in</button></div>
            </>
          ) : (
            <>
              <p>{isSignup ? "Create an account to get started." : "Sign in to continue where your pipeline left off."}</p>
              {isSignup ? (
                <p className="panel-note">Public signups receive User access. Organization setup is not part of this registration flow.</p>
              ) : (
                <p className="panel-note">Your account role determines the workspace features available after sign in.</p>
              )}

              <form onSubmit={handleSubmit} noValidate>
                {isSignup && (
                  <label htmlFor="auth-full-name">Full name
                    <input id="auth-full-name" name="name" autoComplete="name" required maxLength={255} value={fullName} onChange={(event) => setFullName(event.target.value)} />
                  </label>
                )}
                <label htmlFor="auth-email">Work email
                  <input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} />
                </label>
                <label htmlFor="auth-password">Password
                  <div className="password-field">
                    <input id="auth-password" name="password" type={show ? "text" : "password"} autoComplete={isSignup ? "new-password" : "current-password"} required minLength={isSignup ? 8 : undefined} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} {...(isSignup ? { "aria-describedby": "auth-password-hint" } : {})} />
                    <button type="button" onClick={() => setShow((value) => !value)} aria-label={show ? "Hide password" : "Show password"}>{show ? "Hide" : "Show"}</button>
                  </div>
                </label>
                {isSignup && <span className="field-hint" id="auth-password-hint">Use 8 to 128 characters.</span>}

                {!isSignup && <p className="field-hint">Session restoration uses an HTTP-only cookie (up to 7 days by default). The access token stays in memory; there is no separate Remember Me option.</p>}
                {formError && <p role="alert" aria-live="polite" style={{ color: "#f87171", fontSize: 12, marginTop: 12 }}>{formError}</p>}
                <Button type="submit" variant="primary" className="auth-submit" disabled={pending}>
                  {pending ? "Please wait…" : isSignup ? <>Create account<ArrowUpRight size={15} /></> : <>Sign in<ArrowUpRight size={15} /> </>}
                </Button>
              </form>

              <div className="auth-footer">
                {isSignup
                  ? <span>Already have an account? <button type="button" onClick={() => navigate("/login")}>Sign in</button></span>
                  : <><button type="button" onClick={() => navigate("/forgot-password")}>Forgot password?</button><span>New to MadLead? <button type="button" onClick={() => navigate("/signup")}>Create account</button></span></>}
              </div>
            </>
          )}
          <small className="legal-copy">By continuing, you agree to MadLead AI’s Terms of Service and Privacy Policy.</small>
        </div>
      </div>
    </div>
  );
}
