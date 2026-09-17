import { Redirect } from "wouter";
import { useSessionQuery } from "@/api/hooks/useSession";

/**
 * Phase 11 — real route protection over the backend session.
 *
 * `useSessionQuery` restores once (refresh cookie → access token → user).
 * While restoring, routes render a loading state — never a flash of login.
 * Unauthenticated visits bounce to /login. The UI never claims
 * authentication the backend cannot verify (no demo session anymore).
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = useSessionQuery();
  if (session.isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    );
  }
  if (!session.data) {
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}
