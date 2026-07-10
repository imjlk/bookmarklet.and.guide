import typia, { type IValidation, type tags } from "typia";

export type BmklBridgeMessage =
  | {
      type: "bmkl:ready";
      appId: string & tags.MinLength<1>;
      frameId?: string;
      capabilities?: string[];
    }
  | {
      type: "bmkl:run-action";
      requestId: string & tags.MinLength<1>;
      action: string & tags.MinLength<1>;
      input: unknown;
    }
  | {
      type: "bmkl:action-result";
      requestId: string & tags.MinLength<1>;
      result: unknown;
    }
  | {
      type: "bmkl:error";
      requestId?: string;
      message: string & tags.MinLength<1>;
    };

export function assertBmklBridgeMessage(input: unknown): BmklBridgeMessage {
  const message = typia.assertEquals<BmklBridgeMessage>(input);
  assertRequiredPayload(message);
  return message;
}

export function validateBmklBridgeMessage(
  input: unknown,
): IValidation<BmklBridgeMessage> {
  const validation = typia.validateEquals<BmklBridgeMessage>(input);
  if (!validation.success) {
    return validation;
  }
  const missing = getMissingPayload(validation.data);
  if (!missing) {
    return validation;
  }
  return {
    success: false,
    data: input,
    errors: [
      {
        path: `$input.${missing}`,
        expected: "required property",
        value: undefined,
      },
    ],
  };
}

export function isBmklBridgeMessage(
  input: unknown,
): input is BmklBridgeMessage {
  return (
    typia.equals<BmklBridgeMessage>(input) &&
    getMissingPayload(input) === undefined
  );
}

function assertRequiredPayload(message: BmklBridgeMessage): void {
  const missing = getMissingPayload(message);
  if (missing) {
    throw new Error(`Invalid BMKL bridge message: missing ${missing}.`);
  }
}

function getMissingPayload(input: unknown): "input" | "result" | undefined {
  if (typeof input !== "object" || input === null || !("type" in input)) {
    return undefined;
  }
  const message = input as Record<string, unknown>;
  if (
    message.type === "bmkl:run-action" &&
    !Object.prototype.hasOwnProperty.call(message, "input")
  ) {
    return "input";
  }
  if (
    message.type === "bmkl:action-result" &&
    !Object.prototype.hasOwnProperty.call(message, "result")
  ) {
    return "result";
  }
  return undefined;
}
