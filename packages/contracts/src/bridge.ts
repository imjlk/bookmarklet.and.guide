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
  return typia.assertEquals<BmklBridgeMessage>(input);
}

export function validateBmklBridgeMessage(
  input: unknown,
): IValidation<BmklBridgeMessage> {
  return typia.validateEquals<BmklBridgeMessage>(input);
}

export function isBmklBridgeMessage(
  input: unknown,
): input is BmklBridgeMessage {
  return typia.equals<BmklBridgeMessage>(input);
}
