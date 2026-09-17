import { describe, expect, it } from "vitest";
import {
  ApiError,
  getStartCallErrorMessage,
  getUserMessage,
  TELEPHONY_NOT_CONFIGURED_MESSAGE,
} from "@/api/errors";

const EXPECTED =
  "Voice calling is not configured. Add a supported Vapi/Twilio phone number to place outbound calls.";

describe("start-call telephony-unconfigured messaging (Calls page + Lead Details)", () => {
  it("exposes the exact required message constant", () => {
    expect(TELEPHONY_NOT_CONFIGURED_MESSAGE).toBe(EXPECTED);
  });

  it("maps the backend 503 telephony signal to the exact message", () => {
    const err = new ApiError("unavailable", "Voice calling is not configured", 503);
    expect(getStartCallErrorMessage(err)).toBe(EXPECTED);
  });

  it("passes every other failure through the generic safe mapping", () => {
    expect(getStartCallErrorMessage(new ApiError("server", "x", 502))).toBe(getUserMessage(new ApiError("server", "x", 502)));
    expect(getStartCallErrorMessage(new ApiError("server", "x", 502))).toBe(
      "Something went wrong on the server. Please try again later."
    );
    expect(getStartCallErrorMessage(new ApiError("not-found", "Lead not found", 404))).toBe(
      "The requested item was not found."
    );
    expect(getStartCallErrorMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });
});
