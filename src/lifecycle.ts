import { CCRRegistry } from "./analyze/ccr_registry.js";
import { SequentialEngine } from "./reason/sequential_engine.js";
import { MemoryBank } from "./reason/memory_bank.js";
import { createCompactHelpers, CompactText, CompactObject } from "./mcp/compact.js";

export class EngineLifecycle {
  private ccr?: CCRRegistry;
  private engine?: SequentialEngine;
  private memoryBank?: MemoryBank;
  private compactText?: CompactText;
  private compactObject?: CompactObject;

  public getCCR(): CCRRegistry {
    if (!this.ccr) this.ccr = new CCRRegistry();
    return this.ccr;
  }

  public getEngine(): SequentialEngine {
    if (!this.engine) this.engine = new SequentialEngine();
    return this.engine;
  }

  public getMemoryBank(): MemoryBank {
    if (!this.memoryBank) this.memoryBank = new MemoryBank();
    return this.memoryBank;
  }

  public getCompactHelpers(): { compactText: CompactText; compactObject: CompactObject } {
    if (!this.compactText || !this.compactObject) {
      const helpers = createCompactHelpers(this.getCCR());
      this.compactText = helpers.compactText;
      this.compactObject = helpers.compactObject;
    }
    return {
      compactText: this.compactText,
      compactObject: this.compactObject,
    };
  }

  public close(): void {
    if (this.memoryBank) {
      this.memoryBank.close();
    }
    if (this.ccr) {
      this.ccr.close();
    }
    if (this.engine) {
      // engine might internally have a close if it uses sqlite.
      if (typeof (this.engine as any).close === "function") {
        (this.engine as any).close();
      }
    }
  }
}
