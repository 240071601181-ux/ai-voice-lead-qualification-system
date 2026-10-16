// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "@/components/app/GlobalSearch";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("wouter", () => ({ useLocation: () => ["/dashboard", navigate] }));
vi.mock("@/api/hooks/useLeads", () => ({ useLeadsQuery: () => ({ data: { leads: [] }, isFetching: false }) }));
vi.mock("@/api/hooks/useConversations", () => ({ useConversationsQuery: () => ({ data: { conversations: [] } }) }));
vi.mock("@/api/hooks/useQualifications", () => ({ useQualificationsListQuery: () => ({ data: { qualifications: [] } }) }));

describe("GlobalSearch access and controls", () => {
  afterEach(() => {
    cleanup();
    navigate.mockClear();
  });

  it("does not render for an unresolved role", () => {
    render(<GlobalSearch role={undefined} />);
    expect(screen.queryByRole("button", { name: /search anything/i })).not.toBeInTheDocument();
  });

  it("excludes administrator destinations for USER while retaining shared search", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch role="USER" />);
    await user.click(screen.getByRole("button", { name: /search anything/i }));
    await user.type(screen.getByPlaceholderText("Search leads, pages…"), "settings");
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
    expect(screen.getByText("No results found.")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Search leads, pages…")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /search anything/i }));
    await user.clear(screen.getByPlaceholderText("Search leads, pages…"));
    await user.type(screen.getByPlaceholderText("Search leads, pages…"), "knowledge");
    expect(await screen.findByText("Knowledge Base")).toBeInTheDocument();
  });

  it("keeps admin destinations searchable and selects a valid route", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch role="ADMIN" />);
    await user.click(screen.getByRole("button", { name: /search anything/i }));
    await user.type(screen.getByPlaceholderText("Search leads, pages…"), "settings");
    await screen.findByText("Settings");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(navigate).toHaveBeenCalledWith("/settings");
    expect(screen.queryByPlaceholderText("Search leads, pages…")).not.toBeInTheDocument();
  });

  it("supports the keyboard shortcut and empty-query close behavior", async () => {
    render(<GlobalSearch role="USER" />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByPlaceholderText("Search leads, pages…")).toBeInTheDocument();
    expect(screen.getByText("Leads")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Search leads, pages…")).not.toBeInTheDocument();
  });
});
