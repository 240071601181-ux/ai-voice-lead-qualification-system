import { useLocation } from "wouter";
import { Button, Card } from "@/components/app/ui";

/** In-app "not found" state for unknown :id params. Uses the app theme. */
export function NotFoundState({ label, backPath }: { label: string; backPath: string }) {
  const [, navigate] = useLocation();
  return (
    <Card className="tab-panel">
      <div className="empty-state">
        <span className="section-kicker">NOT FOUND</span>
        <b>{label} not found</b>
        <span>The requested {label.toLowerCase()} does not exist or you don&apos;t have access to it.</span>
        <Button variant="secondary" onClick={() => navigate(backPath)}>
          Back
        </Button>
      </div>
    </Card>
  );
}
