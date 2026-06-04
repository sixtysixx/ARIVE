import * as fs from "fs";
import * as path from "path";

export interface Thought {
  thoughtNumber: number;
  totalThoughts: number;
  thought: string;
  nextThoughtNeeded: boolean;
  isRevision?: boolean;
  revisesThoughtNum?: number;
  branchToThoughtNum?: number;
  timestamp: string;
  status: "active" | "backtracked";
}

export interface EngineState {
  history: Thought[];
  activePlan: string;
  errors: string[];
}

export class SequentialEngine {
  private statePath: string;
  private history: Thought[] = [];
  private activePlan: string = "";
  private errors: string[] = [];

  constructor(statePath = ".arive/thinking_state.json") {
    this.statePath = statePath;
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.statePath)) {
        const content = fs.readFileSync(this.statePath, "utf-8");
        if (!content.trim()) {
          throw new Error("State file is empty");
        }
        const data = JSON.parse(content);
        if (data && typeof data === "object") {
          this.history = Array.isArray(data.history) ? data.history : [];
          this.activePlan = typeof data.activePlan === "string" ? data.activePlan : "";
          this.errors = Array.isArray(data.errors) ? data.errors : [];
        } else {
          throw new Error("Invalid state format: root must be an object");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SequentialEngine] Failed to load state from ${this.statePath}: ${message}`);
      this.history = [];
      this.activePlan = "";
      this.errors = [`Failed to load state: ${message}`];
    }
  }

  private save() {
    let tempPath: string | null = null;
    try {
      const dir = path.dirname(this.statePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      tempPath = `${this.statePath}.${Math.random().toString(36).slice(2)}.tmp`;
      const content = JSON.stringify(
        {
          history: this.history,
          activePlan: this.activePlan,
          errors: this.errors,
        },
        null,
        2
      );
      fs.writeFileSync(tempPath, content, "utf-8");
      fs.renameSync(tempPath, this.statePath);
      tempPath = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SequentialEngine] Failed to save state to ${this.statePath}: ${message}`);
      this.errors.push(`Failed to save state: ${message}`);
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore secondary failure during cleanup
        }
      }
    }
  }

  public addThought(
    thought: string,
    thoughtNumber: number,
    totalThoughts: number,
    nextThoughtNeeded: boolean,
    isRevision?: boolean,
    revisesThoughtNum?: number,
    branchToThoughtNum?: number
  ): EngineState {
    if (isRevision && revisesThoughtNum !== undefined) {
      // Deactivate all thoughts after the target revision index
      for (const item of this.history) {
        if (item.thoughtNumber > revisesThoughtNum) {
          item.status = "backtracked";
        }
      }
    }

    const newThought: Thought = {
      thoughtNumber,
      totalThoughts,
      thought,
      nextThoughtNeeded,
      isRevision,
      revisesThoughtNum,
      branchToThoughtNum,
      timestamp: new Date().toISOString(),
      status: "active"
    };

    this.history.push(newThought);
    this.save();
    return this.getState();
  }

  public addError(err: string) {
    this.errors.push(err);
    this.save();
  }

  public clearErrors() {
    this.errors = [];
    this.save();
  }

  public setErrors(errors: string[]) {
    this.errors = [...errors];
    this.save();
  }

  public updatePlan(plan: string) {
    this.activePlan = plan;
    this.save();
  }

  public getState(): EngineState {
    return {
      history: this.history,
      activePlan: this.activePlan,
      errors: this.errors
    };
  }

  public clear() {
    this.history = [];
    this.activePlan = "";
    this.errors = [];
    this.save();
  }
}
