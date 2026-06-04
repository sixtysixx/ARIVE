import { SequentialEngine } from "../reason/sequential_engine.js";
import { createHash } from "crypto";

export class Validator {
  public static backpropagate(engine: SequentialEngine, failures: string[]): void {
    engine.setErrors(failures);
  }

  public static verifyHash(content: string, expectedHash: string): boolean {
    if (!expectedHash || typeof expectedHash !== "string" || !expectedHash.startsWith("ccr:")) {
      return false;
    }
    // Expected hash comes in format ccr:sha256
    const cleanHash = expectedHash.replace(/^ccr:/, "");
    const computed = createHash("sha256").update(content).digest("hex");
    return computed === cleanHash;
  }
}
