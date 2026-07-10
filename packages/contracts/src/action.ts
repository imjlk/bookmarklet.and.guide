import type { IValidation, tags } from "typia";
import type { BmklDebugEvent } from "./debug.js";

export interface BmklActionContext {
  signal?: AbortSignal;
  emit?(event: BmklDebugEvent): void;
}

export interface BmklAction<Input = unknown, Output = unknown> {
  name: string & tags.MinLength<1>;
  description?: string;
  assertInput(input: unknown): Input;
  validateOutput(output: unknown): IValidation<Output>;
  run(
    input: Input,
    context: BmklActionContext,
  ): Output | Promise<Output>;
}

export function defineBmklAction<const Action extends BmklAction>(
  action: Action,
): Action {
  return action;
}
