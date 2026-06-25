# Ponytail Skills

## ponytail-review

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

---

## ponytail-audit

Audit the whole repo for over-engineering and complexity. Scan the whole tree. Rank findings biggest cut first.

Tags: Same as ponytail-review (delete, stdlib, native, yagni, shrink).

Output:
One line per finding: <tag> <what to cut>. <replacement>. [path]
End with: net: -<N> lines, -<M> deps possible.
