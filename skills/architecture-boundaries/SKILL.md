---
name: architecture-boundaries
description: Ownership and dependency rules for keeping features, shared code, and infrastructure separate in any codebase. Use when adding modules, moving code, adding imports across areas, or when the lifecycle gate reports a boundary violation.
license: MIT
metadata:
  version: "1.0.0"
---

# Architecture Boundaries

## Principles

- **Feature ownership.** Behavior lives with the feature that owns it, as a vertical
  slice: its actions, services, schemas, data access, and feature-specific
  components sit together. If logic belongs to one feature, keep it there.
- **Rule of three.** Code moves to a shared location only after it is truly
  reusable across features, normally once a third feature needs it. Two callers are
  a coincidence; extracting early creates an abstraction nobody owns.
- **No dumping grounds.** Do not create broad `utils`, `helpers`, or `common`
  files for business behavior. Shared locations hold narrow infrastructure and
  design primitives, not domain rules.
- **UI renders state and calls actions.** Components do not own business rules,
  authorization, or persistence. They display what a service returned and invoke
  the owner's action.
- **Validate at boundaries.** Every entrypoint that receives outside input (request
  handler, action, CLI argument, message consumer) validates it with a schema and
  authorizes the caller. Never trust client-provided ids, roles, ordering, or
  ownership; resolve them on the server against the signed-in identity.
- **No business rules in global client state.** Global stores hold view state at
  most. Decisions about what is allowed or what a value means belong to the owning
  feature's server code.
- **Infrastructure through the owner.** Database, HTTP, filesystem, and queue access
  goes through the feature's services or a narrow data module. Do not scatter
  database calls through generic components or shared helpers.

## Cross-feature imports

A feature may import another feature only through an intentional public entrypoint:
an index file, a `public/` folder, or a declared interface the owner maintains.
Importing another feature's internals couples two areas to one file layout and
turns every refactor into a cross-team change. When you need something from
another feature and no entrypoint exists, choose in this order: expose one from the
owner with a small, stable surface; extract the code to a shared location if it
passes the rule of three; or call the owner's service instead of reaching into its
files.

## Configuring the gate

`rules.boundaries` in `.staff-engineer/config.json` is a list of rules. Each rule
names the importing files, the forbidden import targets, and carve-outs:

```json
{
  "rules": {
    "boundaries": [
      {
        "id": "no-cross-feature",
        "files": ["src/features/*/**"],
        "forbid": ["src/features/*/**"],
        "allow": ["src/features/*/index.*", "src/features/*/public/**"],
        "sameArea": true,
        "message": "Import another feature only through its public entrypoint."
      },
      {
        "id": "components-no-features",
        "files": ["src/components/**"],
        "forbid": ["src/features/**"],
        "message": "Shared components must not depend on feature code; pass data and callbacks in."
      },
      {
        "id": "lib-no-app-code",
        "files": ["src/lib/**"],
        "forbid": ["src/features/**", "src/app/**"],
        "message": "Shared lib is infrastructure; it must not import application code."
      }
    ]
  }
}
```

- `files` selects the importing files by glob.
- `forbid` selects import targets. Relative imports are resolved to repository
  paths for JavaScript, TypeScript, and Python; Go uses module paths.
- `allow` carves exceptions out of `forbid`: a target matching `allow` passes.
- `sameArea: true` permits imports inside the same area. The area is the path up to
  and including the first wildcard segment of `files`: for `src/features/*/**` the
  area of `src/features/billing/invoice.ts` is `src/features/billing`, so a feature
  may import its own files but not another feature's.
- `message` is shown to whoever hits the rule; write it as the fix, not the
  complaint.

The gate inspects newly added import lines in the staged batch only, so it never
blocks on legacy debt. When a batch must keep an existing violation, record it once
with `node .staff-engineer/cli.mjs exception add --rule <id> --path <glob> --reason "..."`
and remove the entry in the same batch that fixes the import; a stale exception
fails the gate.

## When the gate fires

Take the options in order and stop at the first that fits:

1. **Move the code to its owner.** The imported logic usually belongs where it is
   used, or the importer belongs with the feature it depends on.
2. **Expose a public entrypoint.** Add or extend the owner's index or `public/`
   surface with the smallest stable export that serves the need.
3. **Extract shared code.** Only when the rule of three is satisfied and the code is
   infrastructure or a design primitive, not business behavior.
4. **Record a justified temporary exception** with a reason that names the plan and
   the concern that will remove it. Repeat the reason in the handoff.

Never widen `allow` or loosen `forbid` just to pass. A rule change is an
architecture decision, not a workaround; make it deliberately and document it.

## Documenting decisions

A boundary change that affects more than one area (a new shared module, a new
public entrypoint used by several features, a rule added or relaxed) is a design
decision. Use `spec-and-plan` to write it down, get agreement before building, and
keep the rule list in config in step with the written decision. When adding a new
feature, create it as a complete slice from the start so the gate has a clear owner
to protect.
