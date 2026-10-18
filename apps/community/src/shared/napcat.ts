/** Sanitized observations only; no bot identities, URLs, credentials or provider messages. */
export type NapcatState = "online" | "offline" | "unreachable";
export type NapcatFailure = "qq_offline" | "timeout" | "provider_error" | "connection_error";
export type NapcatObservation = {
  state: NapcatState | "unknown" | "disabled";
  checkedAt: string | null;
  changedAt: string | null;
  failure: NapcatFailure | null;
};
