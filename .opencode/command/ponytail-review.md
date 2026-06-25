---
description: Ponytail ponytail-review command
---
Review diffs for unnecessary complexity. One line per finding: location, what to cut, what replaces it. The diff's best outcome is getting shorter.

Format:
L<line>: <tag> <what>. <replacement>., or <file>:L<line>: ... for multi-file diffs.

Tags:
- delete: dead code, unused flexibility.
- stdlib: hand-rolled thing the standard library ships.
- native: dependency or code doing what the platform already does.
- yagni: abstraction with one implementation, config nobody sets.
- shrink: same logic, fewer lines.

Scoring:
End with: net: -<N> lines possible.