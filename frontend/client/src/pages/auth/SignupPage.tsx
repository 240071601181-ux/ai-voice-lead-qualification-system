import { Redirect } from "wouter";
import { AuthScreen } from "./AuthScreen";
import { useSessionQuery } from "@/api/hooks/useSession";

export default function SignupPage() {
  const session = useSessionQuery();
  // Already signed in (backend-verified): bounce into the app.
  if (!session.isPending && session.data) return <Redirect to="/dashboard" />;
  return <AuthScreen mode="/signup" />;
}
