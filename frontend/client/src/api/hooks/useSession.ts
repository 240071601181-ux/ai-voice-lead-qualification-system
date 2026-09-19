/**
 * Phase 11 — Session hooks over the real backend auth API.
 *
 * `useSessionQuery` is the single session source: boot restoration runs once
 * (refresh cookie → access token → user), RequireAuth gates on it, and
 * login/logout mutations keep it in sync. No demo session, no pasted tokens.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../errors";
import {
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  restoreSession,
  updateProfileName as apiUpdateProfileName,
} from "../session";

export const sessionKeys = {
  all: ["session"] as const,
  current: () => [...sessionKeys.all, "current"] as const,
};

/** Restores once per mount tree; loading doubles as the auth gate state. */
export function useSessionQuery() {
  return useQuery({
    queryKey: sessionKeys.current(),
    queryFn: () => restoreSession(),
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useLoginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => apiLogin(input),
    onSuccess: (user) => {
      queryClient.setQueryData(sessionKeys.current(), user);
    },
  });
}

export function useRegisterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string; name?: string }) =>
      apiRegister(input),
    onSuccess: (user) => {
      queryClient.setQueryData(sessionKeys.current(), user);
    },
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiLogout(),
    onSettled: () => {
      queryClient.setQueryData(sessionKeys.current(), null);
      // Drop cached conversation rows: the next login must not see them.
      queryClient.removeQueries({ queryKey: ["conversations"] });
    },
  });
}

/** Persist the display name; reseeds the session cache on success. */
export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiUpdateProfileName(name),
    onSuccess: (user) => {
      queryClient.setQueryData(sessionKeys.current(), user);
    },
  });
}

/** True when the backend could not verify the caller (login required). */
export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "unauthorized";
}
