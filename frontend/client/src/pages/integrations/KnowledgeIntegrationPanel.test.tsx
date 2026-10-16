// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeIntegrationPanel } from "@/pages/integrations/KnowledgeIntegrationPanel";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
let role: string | undefined = "USER";

vi.mock("wouter", () => ({ useLocation: () => ["/knowledge", navigate] }));
vi.mock("@/api/hooks/useSession", () => ({ useSessionQuery: () => ({ data: role ? { role } : null, isPending: false }) }));
vi.mock("@/api/hooks/useKnowledge", () => ({
  // Phase 5 — fixtures match the real diagnostics contract
  // (KnowledgeDiagnostics always carries a checks array; the backend
  // builds it unconditionally and backend tests enforce it).
  useKnowledgeDocumentsQuery: () => ({ data: { documents: [], total: 0 }, isPending: false, isError: false, refetch: vi.fn() }),
  useKnowledgeDiagnosticsQuery: () => ({ data: { status: "ok", checks: [], documentCount: 0, chunkCount: 0, embeddingProvider: "test", embeddingDimension: 1 }, isPending: false, isError: false, isFetching: false, refetch: vi.fn() }),
  useKnowledgeDocumentQuery: () => ({ data: { document: null, chunks: [] }, isPending: false, isError: false, refetch: vi.fn() }),
}));

describe("Knowledge page actions", () => {
  afterEach(() => {
    cleanup();
    navigate.mockClear();
  });

  it("keeps browsing/search available to USER and hides ingest controls including dialogs", async () => {
    role = "USER";
    const user = userEvent.setup();
    render(<KnowledgeIntegrationPanel onToast={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ingest document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ingest your first document" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sync now" }));
    expect(screen.queryByRole("button", { name: "Ingest document" })).not.toBeInTheDocument();
  });

  it("keeps the ingest action available to ADMIN", () => {
    role = "ADMIN";
    render(<KnowledgeIntegrationPanel onToast={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Ingest document" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ingest your first document" })).toBeInTheDocument();
  });
});
