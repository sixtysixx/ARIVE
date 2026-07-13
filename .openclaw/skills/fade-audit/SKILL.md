---
name: fade-audit
description: Fade fade-audit skill
---
Audit the whole repo for over-engineering and complexity. Scan the whole tree. Rank findings biggest cut first.

Tags: Same as fade-review (delete, stdlib, native, yagni, shrink).

Output:
One line per finding: <tag> <what to cut>. <replacement>. [path]
End with: net: -<N> lines, -<M> deps possible.