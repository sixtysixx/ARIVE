// fallow-ignore-file unused-class-member
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

export type AskShape = "trivial" | "question" | "task" | "plan-first";

export interface IntentRecord {
  code: string;
  check: string;
  spec: string;
  raw: string;
}

export interface FableJudgeVerdict {
  verdict: "VERIFIED" | "CAVEATS" | "REFUTED";
  verifiedClaims: string[];
  caveats: string[];
  refutations: string[];
  score: number;
}

export interface EngineState {
  history: Thought[];
  activePlan: string;
  errors: string[];
  askShape?: AskShape;
  definedDone?: string;
  intents?: IntentRecord[];
  judgeVerdict?: FableJudgeVerdict;
}

export interface PersonaAudit {
  role: string;
  score: number;
  feedback: string;
}

export interface ConsensusReport {
  averageScore: number;
  personas: PersonaAudit[];
  fableVerdict?: FableJudgeVerdict;
}

/** SQLite row shapes — typed to what the schema actually stores. */
interface EngineStateRow {
  active_plan: string | null;
  errors: string | null;
  ask_shape?: string | null;
  defined_done?: string | null;
  intents?: string | null;
  judge_verdict?: string | null;
}

interface ThoughtRow {
  thought_number: number;
  total_thoughts: number;
  thought: string;
  next_thought_needed: number | boolean;
  is_revision: number | boolean;
  revises_thought_num: number | null;
  branch_to_thought_num: number | null;
  timestamp: string;
  status: string;
}

export class SequentialEngine {
  private db: Database;
  private statePath: string;

  constructor(statePath = ".arive/thinking_state.db") {
    const resolved = path.resolve(process.cwd(), statePath);
    this.statePath = resolved;
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(resolved);
    this.initDb();
  }

  private initDb() {
    this.db.run("PRAGMA journal_mode=WAL;");
    this.db.run("PRAGMA busy_timeout=5000;");
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
        errors TEXT,
        ask_shape TEXT,
        defined_done TEXT,
        intents TEXT,
        judge_verdict TEXT
      );
    `);

    // Migrate existing engine_state tables by adding new columns if missing
    const newCols = [
      "ask_shape TEXT",
      "defined_done TEXT",
      "intents TEXT",
      "judge_verdict TEXT",
    ];
    for (const colDef of newCols) {
      try {
        this.db.run(`ALTER TABLE engine_state ADD COLUMN ${colDef};`);
      } catch {
        // Column already exists, safe to ignore
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
    branchToThoughtNum?: number,
    sessionId: string = "default",
  ): EngineState {
    const tx = this.db.transaction(() => {
      if (isRevision && revisesThoughtNum !== undefined) {
        this.db.run(
          "UPDATE thoughts SET status = 'backtracked' WHERE session_id = ? AND thought_number > ?",
          [sessionId, revisesThoughtNum],
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
          "active",
        ],
      );
    });
    tx();

    // Auto-detect Fable Intent Gate records
    const intent = this.parseIntentGate(thought);
    if (intent) {
      this.recordIntent(intent, sessionId);
    }

    return this.getState(sessionId);
  }

  private modifyState(
    sessionId: string,
    updater: (state: {
      activePlan: string;
      errors: string[];
      askShape?: AskShape;
      definedDone?: string;
      intents?: IntentRecord[];
      judgeVerdict?: FableJudgeVerdict;
    }) => {
      activePlan: string;
      errors: string[];
      askShape?: AskShape;
      definedDone?: string;
      intents?: IntentRecord[];
      judgeVerdict?: FableJudgeVerdict;
    }
  ) {
    const tx = this.db.transaction(() => {
      const state = this.getInternalState(sessionId);
      const newState = updater(state);
      this.saveInternalState(sessionId, newState);
    });
    tx();
  }

  public classifyAsk(ask: string): AskShape {
    const text = ask.toLowerCase().trim();
    if (
      text.length < 100 &&
      !text.includes("\n") &&
      (text.startsWith("fix typo") || text.startsWith("rename") || text.includes("trivial"))
    ) {
      return "trivial";
    }
    if (
      text.includes("plan") ||
      text.includes("proposal") ||
      text.includes("architect") ||
      text.includes("irreversible")
    ) {
      return "plan-first";
    }
    if (
      text.startsWith("why") ||
      text.startsWith("how") ||
      text.startsWith("what") ||
      text.includes("explain") ||
      text.includes("question") ||
      text.includes("assess")
    ) {
      return "question";
    }
    return "task";
  }

  public parseIntentGate(text: string): IntentRecord | null {
    const match = /INTENT:\s*code\s+(?:does\s+)?(.*?)\s*\/\s*check\s+(?:expects\s+)?(.*?)\s*\/\s*spec\s+(?:says\s+)?(.*)/i.exec(text);
    if (match) {
      return {
        code: match[1].trim(),
        check: match[2].trim(),
        spec: match[3].trim(),
        raw: match[0].trim(),
      };
    }
    if (text.includes("INTENT:")) {
      const line = text.split("\n").find((l) => l.includes("INTENT:"));
      return {
        code: line || text,
        check: "implied",
        spec: "implied",
        raw: line || text,
      };
    }
    return null;
  }

  public setAskShape(askShape: AskShape, sessionId: string = "default") {
    this.modifyState(sessionId, (state) => ({
      ...state,
      askShape,
    }));
  }

  public defineDone(verificationCheckName: string, sessionId: string = "default") {
    this.modifyState(sessionId, (state) => ({
      ...state,
      definedDone: verificationCheckName,
    }));
  }

  public recordIntent(intent: IntentRecord, sessionId: string = "default") {
    this.modifyState(sessionId, (state) => ({
      ...state,
      intents: [...(state.intents || []), intent],
    }));
  }

  public runFableJudge(
    claims: string[],
    observations: { check: string; status: "passed" | "failed" | "unobserved"; details?: string }[],
    sessionId: string = "default"
  ): FableJudgeVerdict {
    const verifiedClaims: string[] = [];
    const caveats: string[] = [];
    const refutations: string[] = [];

    for (let i = 0; i < claims.length; i++) {
      const claim = claims[i];
      const claimNorm = claim.toLowerCase().trim();

      // Look for explicit observation matching this claim
      let obs = observations.find((o) => {
        const checkNorm = o.check.toLowerCase().trim();
        return checkNorm === claimNorm || checkNorm.includes(claimNorm) || claimNorm.includes(checkNorm);
      });

      // Fall back to index i if check is relevant
      if (!obs && observations[i]) {
        const indexCheck = observations[i].check.toLowerCase().trim();
        if (indexCheck === claimNorm || (claimNorm.length >= 5 && indexCheck.includes(claimNorm.slice(0, 10)))) {
          obs = observations[i];
        }
      }

      if (!obs || obs.status === "unobserved") {
        caveats.push(`Claim "${claim}" was not directly observed or re-verified.`);
      } else if (obs.status === "passed") {
        verifiedClaims.push(claim);
      } else if (obs.status === "failed") {
        refutations.push(`Claim "${claim}" failed verification: ${obs.details || "assertion error"}`);
      }
    }

    let verdict: "VERIFIED" | "CAVEATS" | "REFUTED" = "VERIFIED";
    if (refutations.length > 0) {
      verdict = "REFUTED";
    } else if (caveats.length > 0 || verifiedClaims.length < claims.length) {
      verdict = "CAVEATS";
    }

    const total = claims.length || 1;
    const score = Math.round((verifiedClaims.length / total) * 100);

    const judgeVerdict: FableJudgeVerdict = {
      verdict,
      verifiedClaims,
      caveats,
      refutations,
      score,
    };

    this.modifyState(sessionId, (state) => ({
      ...state,
      judgeVerdict,
    }));

    return judgeVerdict;
  }

  public setErrors(errors: string[], sessionId: string = "default") {
    this.modifyState(sessionId, (state) => ({
      ...state,
      errors,
    }));
  }

  private safeJsonParse<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private getInternalState(sessionId: string): {
    activePlan: string;
    errors: string[];
    askShape?: AskShape;
    definedDone?: string;
    intents?: IntentRecord[];
    judgeVerdict?: FableJudgeVerdict;
  } {
    const row = this.db
      .query(
        "SELECT active_plan, errors, ask_shape, defined_done, intents, judge_verdict FROM engine_state WHERE session_id = ?",
      )
      .get(sessionId) as EngineStateRow | null;
    if (row) {
      return {
        activePlan: row.active_plan ?? "",
        errors: this.safeJsonParse<string[]>(row.errors, []),
        askShape: (row.ask_shape as AskShape) || undefined,
        definedDone: row.defined_done ?? undefined,
        intents: row.intents ? this.safeJsonParse<IntentRecord[] | undefined>(row.intents, undefined) : undefined,
        judgeVerdict: row.judge_verdict ? this.safeJsonParse<FableJudgeVerdict | undefined>(row.judge_verdict, undefined) : undefined,
      };
    }
    return { activePlan: "", errors: [] };
  }

  private saveInternalState(
    sessionId: string,
    state: {
      activePlan: string;
      errors: string[];
      askShape?: AskShape;
      definedDone?: string;
      intents?: IntentRecord[];
      judgeVerdict?: FableJudgeVerdict;
    },
  ) {
    this.db.run(
      "INSERT OR REPLACE INTO engine_state (session_id, active_plan, errors, ask_shape, defined_done, intents, judge_verdict) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        sessionId,
        state.activePlan,
        JSON.stringify(state.errors),
        state.askShape ?? null,
        state.definedDone ?? null,
        state.intents ? JSON.stringify(state.intents) : null,
        state.judgeVerdict ? JSON.stringify(state.judgeVerdict) : null,
      ],
    );
  }

  public getState(sessionId: string = "default"): EngineState {
    const internal = this.getInternalState(sessionId);
    const thoughtsRows = this.db
      .query("SELECT * FROM thoughts WHERE session_id = ? ORDER BY id ASC")
      .all(sessionId) as ThoughtRow[];

    const history: Thought[] = thoughtsRows.map((row) => ({
      thoughtNumber: row.thought_number,
      totalThoughts: row.total_thoughts,
      thought: row.thought,
      nextThoughtNeeded: Boolean(row.next_thought_needed),
      isRevision: Boolean(row.is_revision),
      revisesThoughtNum: row.revises_thought_num ?? undefined,
      branchToThoughtNum: row.branch_to_thought_num ?? undefined,
      timestamp: row.timestamp,
      status: row.status as "active" | "backtracked",
    }));

    return {
      history,
      activePlan: internal.activePlan,
      errors: internal.errors,
      askShape: internal.askShape,
      definedDone: internal.definedDone,
      intents: internal.intents,
      judgeVerdict: internal.judgeVerdict,
    };
  }


  public close() {
    this.db.close();
  }

  public evaluateConsensus(sessionId: string = "default"): ConsensusReport {
    const state = this.getState(sessionId);
    const thoughtsText = state.history
      .filter((t) => t.status === "active")
      .map((t) => t.thought)
      .join(" ");

    const wordCount = thoughtsText.split(/\s+/).length;

    // Refined heuristic
    let baseScore = 50;

    // Density of technical terms (simple heuristic: words > 5 chars or containing special symbols)
    const techWords = thoughtsText
      .split(/\s+/)
      .filter((w) => w.length > 5 || /[\._\(\)\[\]\{\}]/.test(w)).length;
    const techDensity = wordCount > 0 ? techWords / wordCount : 0;

    baseScore += Math.min(20, techDensity * 100);

    if (
      thoughtsText.toLowerCase().includes("verify") ||
      thoughtsText.toLowerCase().includes("test")
    ) {
      baseScore += 15;
    }

    // Check for explicit verification steps
    const verifySteps = (thoughtsText.match(/verify|test|run|check/gi) || [])
      .length;
    baseScore += Math.min(15, verifySteps * 3);

    const devScore = Math.min(100, baseScore + 5);
    const auditorScore = Math.min(100, Math.max(20, baseScore - 10));
    const testerScore = thoughtsText.toLowerCase().includes("test")
      ? Math.min(100, baseScore + 10)
      : Math.max(30, baseScore - 15);

    // Fable Method Judge persona score
    let fableScore = 50;
    if (state.definedDone) fableScore += 15;
    if (state.intents && state.intents.length > 0) fableScore += 15;
    if (state.judgeVerdict) {
      fableScore = state.judgeVerdict.score;
    } else if (thoughtsText.toLowerCase().includes("intent:")) {
      fableScore += 20;
    }
    fableScore = Math.min(100, fableScore);

    const personas: PersonaAudit[] = [
      {
        role: "Developer",
        score: devScore,
        feedback:
          techDensity > 0.2
            ? "High technical density noted."
            : "Basic implementation coverage.",
      },
      {
        role: "Auditor",
        score: auditorScore,
        feedback:
          verifySteps > 2
            ? "Strong verification sequence."
            : "Needs more explicit verification steps.",
      },
      {
        role: "Tester",
        score: testerScore,
        feedback: thoughtsText.toLowerCase().includes("test")
          ? "Test scenarios included."
          : "No explicit test scenarios found.",
      },
      {
        role: "FableJudge",
        score: fableScore,
        feedback: state.judgeVerdict
          ? `Verdict: ${state.judgeVerdict.verdict} (${state.judgeVerdict.verifiedClaims.length} claims verified)`
          : state.intents && state.intents.length > 0
            ? "Fable Intent Gate recorded."
            : "No explicit Fable Judge verdict yet.",
      },
    ];

    const avg = Math.round(
      personas.reduce((sum, p) => sum + p.score, 0) / personas.length
    );

    const report: ConsensusReport = {
      averageScore: avg,
      personas,
      fableVerdict: state.judgeVerdict,
    };

    return report;
  }
}
