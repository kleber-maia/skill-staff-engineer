# Changelog

One line per notable change. Breaking changes are marked **breaking**.

- **0.6.0** Risk-sized code review (`review`: minimum, standard, detailed) replaces the standalone simplify step; `ship` requires a current review.
- **0.5.0** Local insight history; findings surface at `begin`, milestones at `ship`, summary via `stats`.
- **0.4.0** Daily, self-saving toolkit updates (offline now defaults to `allow`); committed decisions log; free preview probes (`brief --check`); machine-local `settings`.
- **0.3.0** **breaking:** approvals use `--approval-quote` instead of `STAFF_ENGINEER_*_APPROVED=1`, and saving needs a handoff of the verified batch. Adds `next` and work lanes (`begin --lane`).
