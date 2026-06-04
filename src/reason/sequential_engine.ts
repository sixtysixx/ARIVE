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
        const data = JSON.parse(content);
        this.history = data.history || [];
        this.activePlan = data.activePlan || "";
        this.errors = data.errors || [];
      }
    } catch (e) {
      this.history = [];
    }
  }

  private save() {
    try {
      const dir = path.dirname(this.statePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.statePath,
        JSON.stringify({ history: this.history, activePlan: this.activePlan, errors: this.errors }, null, 2),
        "utf-8"
      );
    } catch (e) {}
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
