import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { Check, ChevronLeft } from "lucide-react";
import { Button, Card } from "@/components/app/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { NotFoundState } from "@/components/app/NotFoundState";
import { useToast } from "@/layouts/AppLayout";
import { useLeadDetail, useUpdateLeadMutation } from "@/api/hooks/useLeads";
import { getUserMessage } from "@/api/errors";
import type { Lead as ApiLead } from "@/api/types";
import type { UpdateLeadInput } from "@/api/types";

type FormValues = { source: string; name: string; phone: string; email: string; status: string };

function initialFromApi(api: ApiLead): FormValues {
  return {
    source: api.source ?? "",
    name: api.name ?? "",
    phone: api.phone ?? "",
    email: api.email ?? "",
    status: api.status ?? "",
  };
}

function EditForm({
  id,
  initial,
  onSaved,
}: {
  id: string;
  initial: FormValues;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [values, setValues] = useState<FormValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const mutation = useUpdateLeadMutation();

  const set = (key: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setFieldErrors((errs) => ({ ...errs, [key]: undefined }));
  };

  const handleSubmit = () => {
    if (mutation.isPending) return; // prevent duplicate submission
    const errs: Partial<Record<keyof FormValues, string>> = {};
    if (!values.name.trim()) errs.name = "Full name is required.";
    if (!values.phone.trim()) errs.phone = "Phone is required.";
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    // Only backend-supported fields are sent. Demo-only display fields
    // (company, route, vehicle, budget) are never included.
    const payload: UpdateLeadInput = {
      name: values.name.trim(),
      phone: values.phone.trim(),
    };
    if (values.source.trim()) payload.source = values.source.trim();
    if (values.email.trim()) payload.email = values.email.trim();
    if (values.status.trim()) payload.status = values.status.trim();

    setSubmitError(null);
    mutation.mutate(
      { id, data: payload },
      {
        onSuccess: () => {
          notify("Lead saved");
          onSaved();
        },
        onError: (error) => setSubmitError(getUserMessage(error)),
      }
    );
  };

  const err = (key: keyof FormValues) =>
    fieldErrors[key] ? (
      <small style={{ color: "#f87171", fontSize: 10 }}>{fieldErrors[key]}</small>
    ) : null;

  return (
    <>
      <div className="page-heading">
        <div><p className="lede">PIPELINE / LEADS / EDIT</p></div>
        <div className="heading-actions">
          <Button variant="ghost" onClick={onSaved} disabled={mutation.isPending}>Cancel</Button>
          <Button icon={Check} variant="primary" onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
      <Card className="settings-form">
        <div className="settings-section">
          <span className="section-kicker">SHIPPER PROFILE</span>
          <h2>Edit lead</h2>
          <p>
            Changes are saved to the backend via PATCH /api/v1/leads/:id.
          </p>
          <div className="form-grid">
            <label>Full name<input value={values.name} onChange={set("name")} placeholder="e.g. Arjun Rao" />{err("name")}</label>
            <label>Phone<input value={values.phone} onChange={set("phone")} placeholder="e.g. +91 98765 22109" />{err("phone")}</label>
            <label>Source<input value={values.source} onChange={set("source")} placeholder="e.g. web, inbound-call" />{err("source")}</label>
            <label>Email<input value={values.email} onChange={set("email")} placeholder="optional" />{err("email")}</label>
            <label>Status<input value={values.status} onChange={set("status")} placeholder="e.g. New, Contacted" />{err("status")}</label>
          </div>
          {submitError ? (
            <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: "#f87171", fontSize: 11 }}>{submitError}</span>
              <Button variant="secondary" onClick={handleSubmit} disabled={mutation.isPending}>Retry</Button>
            </div>
          ) : null}
        </div>
      </Card>
    </>
  );
}

/**
 * Phase 14C-4 — Lead edit backed by GET + PATCH /api/v1/leads/:id.
 * Loads via the shared detail hook; submits through the API layer only.
 */
export default function LeadEditPage() {
  const params = useParams();
  const [, navigate] = useLocation();
  const id = params.id ?? "";
  const detail = useLeadDetail(id);

  const backToDetail = () => navigate(`/leads/${id}`);

  if (detail.status === "loading") {
    return (
      <>
        <button className="back-link" onClick={backToDetail}><ChevronLeft size={15} />Back to lead</button>
        <Card className="settings-form">
          <Skeleton className="h-4 w-40" />
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        </Card>
      </>
    );
  }
  if (detail.status === "not-found") return <NotFoundState label="Lead" backPath="/leads" />;
  if (detail.status === "error") {
    return (
      <>
        <button className="back-link" onClick={backToDetail}><ChevronLeft size={15} />Back to lead</button>
        <Card className="tab-panel">
          <div className="empty-state">
            <span className="section-kicker">ERROR</span>
            <b>Couldn&apos;t load this lead</b>
            <span>{getUserMessage(detail.error)}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" onClick={backToDetail}>Back</Button>
              <Button variant="primary" onClick={detail.refetch}>Retry</Button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  const initial = initialFromApi(detail.apiLead);
  return (
    <>
      <button className="back-link" onClick={backToDetail}><ChevronLeft size={15} />Back to lead</button>
      <EditForm
        key={`api:${id}`}
        id={id}
        initial={initial}
        onSaved={backToDetail}
      />
    </>
  );
}
