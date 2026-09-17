import { OperationsPage } from "../operations/OperationsPage";
import { useToast } from "@/layouts/AppLayout";

/**
 * Qualifications list from real backend data. The backend exposes no
 * list-all endpoint (only GET by call/lead and POST), so rows are derived
 * honestly in `useQualificationRows`: real leads crossed with their
 * per-lead qualification lookup. Leads without a record contribute no row;
 * with zero records the page shows a truthful empty state (never fake
 * names/scores), and aggregate stats render as unavailable.
 */
export default function QualificationsPage() {
  const { notify } = useToast();
  return <OperationsPage type="/qualifications" onToast={notify} />;
}
