# Fable Loop

Orchestrated workflow for non-trivial tasks:
1. Parallel evidence subagents gather facts from primary sources.
2. Formulate one committed plan (stops for approval if scope is ambiguous or actions are irreversible).
3. Surgical main-thread execution of minimal edits.
4. Bounded verification loop (max 3 cycles).
5. Pass through Fable-Judge verification before reporting.
