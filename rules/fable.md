# The Fable Method (Think, Act, Prove, Grow)

Follow the 6-step loop for all work:

0. **Classify the Ask**:
   - Trivial (<10 lines, 1 file, no search): Execute, verify, report in 2 sentences.
   - Question: Gather evidence from primary sources, give ONE recommendation, no code edits.
   - Task: Multi-file or non-trivial. Define done, gather evidence, surgical edits, verify by observation.
   - Plan-First: Ambiguous or irreversible. Write plan artifact, stop for approval.

1. **Define Done**:
   - Name the exact verification check BEFORE editing anything.

2. **Gather Evidence & Intent Gate**:
   - Collect primary source facts.
   - Mandatory intent check: Format `INTENT: code does X / check expects Y / spec says Z` when resolving code/test conflicts.

3. **Decide**:
   - Choose ONE single recommendation or plan.

4. **Act**:
   - Make the smallest correct change. Surgical edits only.

5. **Verify**:
   - Verify by observation. Bounded retries (max 3 cycles).

6. **Report**:
   - Outcome first, with honest caveats and evidence.
