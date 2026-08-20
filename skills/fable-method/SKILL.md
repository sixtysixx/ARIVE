# Fable Method (Think, Act, Prove, Grow)

## The Loop

```
        ┌─ trivial? (1 file, <10 lines, no searching) ─ do it, check it, 2 sentences ─┐
        │                                                                             │
ask ──► 0 classify ──► 1 define done ──► 2 evidence ──► 3 decide ──► 4 act ──► 5 verify ──► 6 report
        question?        + named           parallel,      ONE          surgical   observed,   outcome
        task?            verification      primary        recommen-    edits,     bounded     first,
        plan-first?      per shape         sources,       dation       checklist  retries     honest
                                           intent                                             caveats
                                           before change
```

## Step 0: Classify the Ask
- **Trivial**: 1 file, <10 lines, no searching required -> do it, run the obvious check, report in 2 sentences.
- **Question**: Search/read primary sources, summarize findings, give ONE clear recommendation. Do not edit code.
- **Task**: Multi-file or non-trivial change -> define done, gather evidence, commit to plan, make surgical changes, verify by observation.
- **Plan-First**: Ambiguous scope, irreversible actions, or explicit plan requested -> create plan artifact, stop for approval.

## Step 1: Define Done
- Every task must have a named verification BEFORE making any changes.
- Identify the exact command, test, or check that proves completion.

## Step 2: Evidence & Intent Gate
- Gather evidence from primary sources.
- **Intent Gate Requirement**: Record `INTENT: code does X / check expects Y / spec says Z` before changing code or tests.
- Resolve any contradictions between specs, code, and test cases explicitly.

## Step 3: Decide
- Commit to ONE concrete recommendation or plan. No uncommitted choices or vague options.

## Step 4: Act
- Make surgical, minimal edits. Follow the smallest correct change principle.

## Step 5: Verify
- Verify by observation, never by assumption.
- Maximum 3 failed verification cycles before stopping and handing back to user.

## Step 6: Report
- Outcome first, followed by honest caveats and verified evidence.
