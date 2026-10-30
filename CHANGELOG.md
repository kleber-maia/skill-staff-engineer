# Changelog

- **0.11.1** Pure documentation changes receive built-in whitespace, newline, local-link and source-line checks without running app tests or builds. Documentation receipts bind to the checked text; mixed, executable, configuration, security and workflow changes retain normal gates. Renames, unstaged changes and symlinks cannot turn code changes into documentation-only verification. Approval controls are unchanged.

- **0.11.0** Completed tasks offer the project’s release process once, after confirmed delivery and any configured deployment. Ignoring or declining leaves the task complete; a clear yes routes the agent through the project’s release playbook, retaining separate publication approvals. Failed deliveries never offer a release.

- **0.10.0** **breaking:** Final approval now defaults on new and existing installs.
  Adds conversational Guided / Final approval / Through delivery modes, visible
  task-start notices, task overrides and remembered preferences, pause/resume,
  agent acceptance and visual evidence, and recoverable configured deployment.
  Guided mode retains the former approval workflow; explicit saved choices survive updates.
  Completion includes a commit and confirmed push as one recoverable delivery operation.

One line per notable change. Breaking changes are marked **breaking**.

- **0.9.0** **breaking:** updates follow published stable GitHub releases instead of the default branch, never downgrade automatically, and verify release tags against toolkit versions. Release publication is manual, requires operator approval after a push, and checks the exact pushed commit, tests, version bump, and changelog before creating a new tag and release. Test discovery works on Node 20 and across shells.
- **0.8.0** **breaking:** remote saves now include confirmed delivery by default; interrupted saves resume the same commit. Approval covers the whole batch, reviews account for every finding, source areas have related tests, reproductions isolate dependencies and local data, and toolkit saves preserve operator edits in shared files. Hooks cover ordinary shell variants, run from subdirectories, and surface failures without blocking the harness.
- **0.7.0** Bug fixes (`begin --bug`) are proven by `repro`: a test that fails on the original code and passes after. Reported review findings become committed known issues, surfaced when later work touches those files.
- **0.6.1** Toolkit maintenance never runs the concern lifecycle: `update` refuses during a concern and saves itself; new `save-toolkit` saves installs and configuration.
- **0.6.0** Risk-sized code review (`review`: minimum, standard, detailed) replaces the standalone simplify step; `ship` requires a current review.
- **0.5.0** Local insight history; findings surface at `begin`, milestones at `ship`, summary via `stats`.
- **0.4.0** Daily, self-saving toolkit updates (offline now defaults to `allow`); committed decisions log; free preview probes (`brief --check`); machine-local `settings`.
- **0.3.0** **breaking:** approvals use `--approval-quote` instead of `STAFF_ENGINEER_*_APPROVED=1`, and saving needs a handoff of the verified batch. Adds `next` and work lanes (`begin --lane`).
