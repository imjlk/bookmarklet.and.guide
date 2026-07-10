import typia, { type IValidation, type tags } from "typia";

export const BMKL_DEBUG_EVENT_SOURCE = "bmkl-debug";

export type BmklDebugEventSource = typeof BMKL_DEBUG_EVENT_SOURCE;
export type BmklDebugMode = "bookmarklet" | "companion";

export interface BmklDebugPageSnapshot {
  url: string & tags.MinLength<1>;
  title?: string;
  target?: string;
  mode?: BmklDebugMode;
}

export interface BmklErrorSnapshot {
  name?: string;
  message?: string;
  stack?: string;
}

export interface BmklDebugEvent {
  source: BmklDebugEventSource;
  eventId: string & tags.MinLength<1>;
  sessionId: string & tags.MinLength<1>;
  startedAt: string & tags.Format<"date-time">;
  time: string & tags.Format<"date-time">;
  type: string & tags.MinLength<1>;
  message: string;
  error?: BmklErrorSnapshot;
  data?: unknown;
  page: BmklDebugPageSnapshot;
}

export interface BmklDebugReport {
  sessionId: string & tags.MinLength<1>;
  startedAt: string & tags.Format<"date-time">;
  page: BmklDebugPageSnapshot;
  events: BmklDebugEvent[];
}

export function assertBmklDebugEvent(input: unknown): BmklDebugEvent {
  return typia.assertEquals<BmklDebugEvent>(input);
}

export function validateBmklDebugEvent(
  input: unknown,
): IValidation<BmklDebugEvent> {
  return typia.validateEquals<BmklDebugEvent>(input);
}

export function isBmklDebugEvent(input: unknown): input is BmklDebugEvent {
  return typia.equals<BmklDebugEvent>(input);
}

export function parseBmklDebugEventJson(input: string): BmklDebugEvent {
  return assertBmklDebugEvent(JSON.parse(input));
}

export function stringifyBmklDebugEvent(input: BmklDebugEvent): string {
  return typia.json.stringify<BmklDebugEvent>(input);
}

export function assertBmklDebugReport(input: unknown): BmklDebugReport {
  return typia.assertEquals<BmklDebugReport>(input);
}

export function validateBmklDebugReport(
  input: unknown,
): IValidation<BmklDebugReport> {
  return typia.validateEquals<BmklDebugReport>(input);
}

export function stringifyBmklDebugReport(input: BmklDebugReport): string {
  return typia.json.stringify<BmklDebugReport>(input);
}
