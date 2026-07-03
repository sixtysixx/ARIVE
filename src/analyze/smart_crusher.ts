/** All legal JSON value shapes — replaces `any` for parsed JSON traversal. */
type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Sentinel shape injected when an array is longer than 2 items. */
interface TruncatedArray {
  $truncated: true;
  $length: number;
  $items: CrushedValue[];
}

type CrushedValue =
  | string
  | number
  | boolean
  | null
  | CrushedValue[]
  | TruncatedArray
  | { [key: string]: CrushedValue };

export class SmartCrusher {
  public static crush(content: string): string {
    try {
      const parsed = JSON.parse(content) as JsonValue;
      return JSON.stringify(SmartCrusher.traverseAndCrush(parsed));
    } catch {
      return content;
    }
  }

  private static traverseAndCrush(val: JsonValue): CrushedValue {
    if (Array.isArray(val)) {
      if (val.length <= 2) {
        return val.map((item) => SmartCrusher.traverseAndCrush(item));
      }
      // Wrap truncated arrays in a typed sentinel object so downstream consumers
      // are never surprised by a string injected into a homogeneous array (e.g. number[]).
      return {
        $truncated: true,
        $length: val.length,
        $items: val
          .slice(0, 2)
          .map((item) => SmartCrusher.traverseAndCrush(item)),
      } satisfies TruncatedArray;
    }
    if (val !== null && typeof val === "object") {
      const newObj: { [key: string]: CrushedValue } = {};
      for (const key of Object.keys(val)) {
        newObj[key] = SmartCrusher.traverseAndCrush(val[key]);
      }
      return newObj;
    }
    return val;
  }
}
