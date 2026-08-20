# Fable Judge

Adversarial verification of finished work:
1. Re-run every claimed check and test.
2. Diff what actually changed against the original baseline.
3. Hunt for weakened tests, silenced assertions, or false completion claims.
4. Output verdict: `VERIFIED`, `CAVEATS`, or `REFUTED`.
