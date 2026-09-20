import { Redirect } from "wouter";
import { useSessionQuery } from "@/api/hooks/useSession";
import { useCustomerSessionProbe } from "@/api/hooks/useCustomer";

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
  const customerProbe = useCustomerSessionProbe(!session.isPending && !session.data);
  if (session.isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    );
  }
  if (!session.data) {
    if (customerProbe.isPending) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-sm text-muted-foreground">Checking your session…</p>
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
