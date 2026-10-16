import { Redirect } from "wouter";
import { useSessionQuery } from "@/api/hooks/useSession";
import { useCustomerSessionProbe } from "@/api/hooks/useCustomer";
import { canAccessPath, isInternalRole } from "@/app/accessPolicy";

/**
 * Phase 11 — real route protection over the backend session.
 * Phase 20 — customer sessions never satisfy this guard: a customer who
 * opens an admin URL is sent back to /chat instead of /login.
 *
 * `useSessionQuery` restores once (refresh cookie → access token → user).
 * While restoring, routes render a loading state — never a flash of login.
 * Unauthenticated visits bounce to /login (or /chat for customers). The UI
 * never claims authentication the backend cannot verify.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = useSessionQuery();
  // Only probed when no internal session exists (logged-out visits).
  // Phase 5 — gate the loading state on the probe actually running: a
  // disabled probe reports isPending, which previously masked the
  // invalid-role branch below behind a permanent spinner.
  const probeEnabled = !session.isPending && !session.data;
  const customerProbe = useCustomerSessionProbe(probeEnabled);
  if (session.isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    );
  }
  if (!session.data || !isInternalRole(session.data.role)) {
    if (probeEnabled && customerProbe.isPending) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-sm text-muted-foreground">Checking your session…</p>
        </div>
      );
    }
    if (session.data && !isInternalRole(session.data.role)) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-sm text-muted-foreground">Unable to verify your account role. Please sign in again.</p>
        </div>
      );
    }
    if (customerProbe.data) {
      return <Redirect to="/chat" />;
    }
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}

/**
 * Phase 21 — ADMIN-only route guard (settings, agent config, ingest…).
 *
 * Builds on RequireAuth: unauthenticated visits still bounce to /login
 * (or /chat for customers); authenticated non-admins get a truthful
 * unauthorized page — never a redirect loop, never hidden-URL access.
 * The backend remains the real boundary (requireRole).
 */
export function RequireAdmin({ children, path = "/settings" }: { children: React.ReactNode; path?: string }) {
  return (
    <RequireAuth>
      <RequireAdminRole path={path}>{children}</RequireAdminRole>
    </RequireAuth>
  );
}

function RequireAdminRole({ children, path }: { children: React.ReactNode; path: string }) {
  const session = useSessionQuery();
  if (session.isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    );
  }
  if (!canAccessPath(session.data?.role, path)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex max-w-md flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm font-semibold">Not authorized</p>
          <p className="text-sm text-muted-foreground">
            This area requires an Admin account. Your signed-in role does not
            include it — contact an administrator if you need access.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
