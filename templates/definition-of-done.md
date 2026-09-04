# Definition of Done

A concern is done only when every line below is true.

- [ ] The operator agreed the outcome and acceptance checks before building (brief recorded).
- [ ] The operator saw a working preview and clearly accepted it.
- [ ] Every acceptance check from the brief passes on the preview.
- [ ] Changed behavior has a changed or added automated test in the same batch (or a recorded waiver).
- [ ] The `simplify` review ran; SAFE and CAREFUL findings are applied, RISKY ones reported.
- [ ] Documentation that describes the changed behavior is updated in the same batch.
- [ ] No debug output, suppressions, weakened types, or unfinished markers remain.
- [ ] No secrets, environment files, logs, backups, or generated output are staged.
- [ ] The lifecycle gate passes on the whole staged concern.
- [ ] The full verification passed once on this exact staged code (receipt is current).
- [ ] The handoff was sent in plain language and the operator replied "ship it".
- [ ] The batch is saved as one commit; nothing unrelated was swept in.
