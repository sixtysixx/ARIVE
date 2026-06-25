import { Database, Statement } from "bun:sqlite";
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

export interface PersonaAudit {
  role: string;
  score: number;
  feedback: string;
}

export interface ConsensusReport {
  averageScore: number;
  personas: PersonaAudit[];
}

export class SequentialEngine {
  private db: Database;
  private statePath: string;

  constructor(statePath = ".arive/thinking_state.db") {
    // Handle migration or different extension if needed, but the plan says use .db
    this.statePath = statePath;
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(statePath);
    this.initDb();
  }

  private initDb() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS thoughts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT DEFAULT 'default',
        thought_number INTEGER,
        total_thoughts INTEGER,
        thought TEXT,
        next_thought_needed BOOLEAN,
        is_revision BOOLEAN,
        revises_thought_num INTEGER,
        branch_to_thought_num INTEGER,
        timestamp TEXT,
        status TEXT
      );
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS engine_state (
        session_id TEXT PRIMARY KEY,
        active_plan TEXT,
        errors TEXT
      );
    `);
  }

  public addThought(
    thought: string,
    thoughtNumber: number,
    totalThoughts: number,
    nextThoughtNeeded: boolean,
    isRevision?: boolean,
    revisesThoughtNum?: number,
    branchToThoughtNum?: number,
    sessionId: string = "default"
  ): EngineState {
    if (isRevision && revisesThoughtNum !== undefined) {
      this.db.run(
        "UPDATE thoughts SET status = 'backtracked' WHERE session_id = ? AND thought_number > ?",
        [sessionId, revisesThoughtNum]
      );
    }

    this.db.run(
      `INSERT INTO thoughts (
        session_id, thought_number, total_thoughts, thought, next_thought_needed, 
        is_revision, revises_thought_num, branch_to_thought_num, timestamp, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        thoughtNumber,
        totalThoughts,
        thought,
        nextThoughtNeeded ? 1 : 0,
        isRevision ? 1 : 0,
        revisesThoughtNum ?? null,
        branchToThoughtNum ?? null,
        new Date().toISOString(),
        "active"
      ]
    );

    return this.getState(sessionId);
  }

  public addError(err: string, sessionId: string = "default") {
    const state = this.getInternalState(sessionId);
    const errors = [...state.errors, err];
    this.saveInternalState(sessionId, state.activePlan, errors);
  }

  public clearErrors(sessionId: string = "default") {
    const state = this.getInternalState(sessionId);
    this.saveInternalState(sessionId, state.activePlan, []);
  }

  public setErrors(errors: string[], sessionId: string = "default") {
    const state = this.getInternalState(sessionId);
    this.saveInternalState(sessionId, state.activePlan, errors);
  }

  public updatePlan(plan: string, sessionId: string = "default") {
    const state = this.getInternalState(sessionId);
    this.saveInternalState(sessionId, plan, state.errors);
  }

  private getInternalState(sessionId: string): { activePlan: string, errors: string[] } {
    const row = this.db.query("SELECT active_plan, errors FROM engine_state WHERE session_id = ?").get(sessionId) as any;
    if (row) {
      return {
        activePlan: row.active_plan || "",
        errors: JSON.parse(row.errors || "[]")
      };
    }
    return { activePlan: "", errors: [] };
  }

  private saveInternalState(sessionId: string, activePlan: string, errors: string[]) {
    this.db.run(
      "INSERT OR REPLACE INTO engine_state (session_id, active_plan, errors) VALUES (?, ?, ?)",
      [sessionId, activePlan, JSON.stringify(errors)]
    );
  }

  public getState(sessionId: string = "default"): EngineState {
    const internal = this.getInternalState(sessionId);
    const thoughtsRows = this.db.query("SELECT * FROM thoughts WHERE session_id = ? ORDER BY id ASC").all(sessionId) as any[];
    
    const history: Thought[] = thoughtsRows.map(row => ({
      thoughtNumber: row.thought_number,
      totalThoughts: row.total_thoughts,
      thought: row.thought,
      nextThoughtNeeded: Boolean(row.next_thought_needed),
      isRevision: Boolean(row.is_revision),
      revisesThoughtNum: row.revises_thought_num,
      branchToThoughtNum: row.branch_to_thought_num,
      timestamp: row.timestamp,
      status: row.status
    }));

    return {
      history,
      activePlan: internal.activePlan,
      errors: internal.errors
    };
  }

  public clear(sessionId: string = "default") {
    this.db.run("DELETE FROM thoughts WHERE session_id = ?", [sessionId]);
    this.db.run("DELETE FROM engine_state WHERE session_id = ?", [sessionId]);
  }

  public close() {
    this.db.close();
  }

  public evaluateConsensus(sessionId: string = "default"): ConsensusReport {
    const state = this.getState(sessionId);
    const thoughtsText = state.history
      .filter(t => t.status === "active")
      .map(t => t.thought)
      .join(" ");

    const wordCount = thoughtsText.split(/\s+/).length;
    
    // Refined heuristic
    let baseScore = 50;
    
    // Density of technical terms (simple heuristic: words > 5 chars or containing special symbols)
    const techWords = thoughtsText.split(/\s+/).filter(w => w.length > 5 || /[\._\(\)\[\]\{\}]/.test(w)).length;
    const techDensity = wordCount > 0 ? techWords / wordCount : 0;
    
    baseScore += Math.min(20, techDensity * 100);
    
    if (thoughtsText.toLowerCase().includes("verify") || thoughtsText.toLowerCase().includes("test")) {
      baseScore += 15;
    }
    
    // Check for explicit verification steps
    const verifySteps = (thoughtsText.match(/verify|test|run|check/gi) || []).length;
    baseScore += Math.min(15, verifySteps * 3);

    const devScore = Math.min(100, baseScore + 5);
    const auditorScore = Math.min(100, Math.max(20, baseScore - 10));
    const testerScore = thoughtsText.toLowerCase().includes("test") ? Math.min(100, baseScore + 10) : Math.max(30, baseScore - 15);

    const report: ConsensusReport = {
      averageScore: Math.round((devScore + auditorScore + testerScore) / 3),
      personas: [
        { role: "Developer", score: devScore, feedback: techDensity > 0.2 ? "High technical density noted." : "Basic implementation coverage." },
        { role: "Auditor", score: auditorScore, feedback: verifySteps > 2 ? "Strong verification sequence." : "Needs more explicit verification steps." },
        { role: "Tester", score: testerScore, feedback: thoughtsText.toLowerCase().includes("test") ? "Test scenarios included." : "No explicit test scenarios found." }
      ]
    };

    return report;
  }
}
