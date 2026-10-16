/**
 * Phase 11 — Session hooks over the real backend auth API.
 *
 * `useSessionQuery` is the single session source: boot restoration runs once
 * (refresh cookie → access token → user), RequireAuth gates on it, and
 * login/logout mutations keep it in sync. No demo session, no pasted tokens.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../errors";
import {
  getSessionUser,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  restoreSession,
  updateProfileName as apiUpdateProfileName,
} from "../session";
import { isInternalRole } from "@/app/accessPolicy";

export const sessionKeys = {
  all: ["session"] as const,
  current: () => [...sessionKeys.all, "current"] as const,
};

/** Restores once per mount tree; loading doubles as the auth gate state. */
export function useSessionQuery() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: sessionKeys.current(),
    queryFn: () => restoreSession(),
    retry: false,
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    const clearProtectedState = () => {
      queryClient.removeQueries({ predicate: (entry) => entry.queryKey[0] !== sessionKeys.all[0] });
      queryClient.setQueryData(sessionKeys.current(), null);
    };
    const updateSession = (event: Event) => {
      const user = (event as CustomEvent<ReturnType<typeof getSessionUser>>).detail;
      if (!user || !isInternalRole(user.role)) {
        clearProtectedState();
        return;
      }
      const previous = queryClient.getQueryData<{ role?: string }>(sessionKeys.current());
      if (previous?.role !== user.role) {
        queryClient.removeQueries({ predicate: (entry) => entry.queryKey[0] !== sessionKeys.all[0] });
      }
      queryClient.setQueryData(sessionKeys.current(), user);
    };
    window.addEventListener("madlead:session-expired", clearProtectedState);
    window.addEventListener("madlead:session-updated", updateSession);
    return () => {
      window.removeEventListener("madlead:session-expired", clearProtectedState);
      window.removeEventListener("madlead:session-updated", updateSession);
    };
  }, [queryClient]);
  return query;
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
    mutationFn: (input: { email: string; password: string; name: string }) =>
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
      queryClient.removeQueries({ predicate: (entry) => entry.queryKey[0] !== sessionKeys.all[0] });
      queryClient.setQueryData(sessionKeys.current(), null);
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
