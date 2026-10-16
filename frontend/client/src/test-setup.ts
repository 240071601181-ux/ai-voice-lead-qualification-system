import "@testing-library/jest-dom/vitest";

/**
 * Phase 5 — jsdom browser-API shims for component tests.
 *
 * jsdom does not implement ResizeObserver (required by the Radix dialog
 * primitives used for search/command palettes). This minimal no-op
 * implementation satisfies the observer contract for tests: it is
 * stateless, holds no callbacks across tests, and performs no layout, so
 * it cannot leak state between suites. Production code is untouched.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

/**
 * jsdom also lacks Element.scrollIntoView (invoked by command-palette
 * primitives when highlighting results). A no-op keeps focus/scroll
 * behavior out of assertions without touching production code.
 */
if (
  typeof Element !== "undefined" &&
  typeof (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView !== "function"
) {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}
