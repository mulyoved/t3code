import { Schema } from "effect";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const DifitState = Schema.Literals(["idle", "starting", "ready", "error"]);
export type DifitState = typeof DifitState.Type;

export const DifitOpenFailureReason = Schema.Literals([
  "no_active_worktree",
  "thread_not_found",
  "spawn_failed",
  "startup_timeout",
  "process_exited",
]);
export type DifitOpenFailureReason = typeof DifitOpenFailureReason.Type;

export const DifitOpenInput = Schema.Struct({
  threadId: ThreadId,
});
export type DifitOpenInput = typeof DifitOpenInput.Type;

export const DifitProcessDiagnostics = Schema.Struct({
  exitCode: Schema.optional(Schema.Number),
  signal: Schema.optional(TrimmedNonEmptyString),
  stdoutTail: Schema.optional(TrimmedNonEmptyString),
  stderrTail: Schema.optional(TrimmedNonEmptyString),
});
export type DifitProcessDiagnostics = typeof DifitProcessDiagnostics.Type;

export const DifitOpenSuccess = Schema.Struct({
  ok: Schema.Literal(true),
  proxyPath: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  sessionRevision: TrimmedNonEmptyString,
});
export type DifitOpenSuccess = typeof DifitOpenSuccess.Type;

export const DifitOpenFailure = Schema.Struct({
  ok: Schema.Literal(false),
  reason: DifitOpenFailureReason,
  diagnostics: Schema.optional(DifitProcessDiagnostics),
});
export type DifitOpenFailure = typeof DifitOpenFailure.Type;

export const DifitOpenResult = Schema.Union([DifitOpenSuccess, DifitOpenFailure]);
export type DifitOpenResult = typeof DifitOpenResult.Type;

export const DifitCloseInput = Schema.Struct({});
export type DifitCloseInput = typeof DifitCloseInput.Type;

export const DifitCloseResult = Schema.Struct({
  ok: Schema.Literal(true),
});
export type DifitCloseResult = typeof DifitCloseResult.Type;

export const DifitStatusInput = Schema.Struct({});
export type DifitStatusInput = typeof DifitStatusInput.Type;

export const DifitStatusResult = Schema.Struct({
  state: DifitState,
  cwd: Schema.optional(TrimmedNonEmptyString),
  proxyPath: Schema.optional(TrimmedNonEmptyString),
  reason: Schema.optional(DifitOpenFailureReason),
  diagnostics: Schema.optional(DifitProcessDiagnostics),
});
export type DifitStatusResult = typeof DifitStatusResult.Type;
