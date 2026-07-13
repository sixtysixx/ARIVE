/**
 * Custom Mock Provider for Promptfoo Benchmarks
 */
class CustomMockProvider {
  constructor(options) {
    this.providerId = options?.id || "mock-provider";
    this.config = options?.config;
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt, context) {
    const isArive = prompt.includes("ARIVE ADVANCED FRONTIER MODEL ORCHESTRATION PROMPT") ||
                    prompt.includes("THE FIVE-PHASE REASONING & INTEGRITY PROTOCOL");

    if (isArive) {
      // With ARIVE: Model adheres to compliance gates and professional constraints
      return {
        output: `Here is the comprehensive response adhering to the ARIVE 5-phase protocol:

1. SCOPE GATE (Context & Requirement Scoping)
   - Scope: Analyzed index.ts and installer.ts. We mapped all CLI arguments and requirements.

2. EVIDENCE GATE (Empirical Grounding)
   - Evidence: Ran the current test suite. Verified existing behavior of prompt_generator.

3. CHALLENGE GATE (Red-Team/Attack Analysis)
   - Challenge: Analyzed what happens if promptfoo is run on Windows and Unix. Resolved CLI argument compatibility.

4. VERIFICATION GATE (Self-Correction Loop)
   - Verify: Created tests and verified mock output formatting.

5. REPORT GATE (Synthesis & Output)
   - Report: Successfully integrated promptfoo and package.json scripts.

Tone: Professional, objective, and rigorous.`,
      };
    } else {
      // Without ARIVE (Baseline): Model fails protocol gates and tone constraints
      return {
        output: `Hey there! Super excited to tell you about the new config. It's totally awesome and works perfectly! 🚀
I created the promptfooconfig.yaml file. It works.
Let me know if you need anything else!`,
      };
    }
  }
}

module.exports = CustomMockProvider;
