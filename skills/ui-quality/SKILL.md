---
name: ui-quality
description: Visual and workflow finish standard for any user-facing surface (web screens, desktop or mobile UI, CLI output, generated documents). Use when designing, building, reviewing, or finishing anything a person sees or interacts with, and run its finalize audit before asking for approval on UI work.
license: MIT
metadata:
  version: "1.0.0"
  upstream:
    source: Leonxlnx/taste-skill
    path: skills/redesign-skill/SKILL.md, skills/minimalist-skill/SKILL.md, skills/soft-skill/SKILL.md
    adapted: true
    reason: The upstream targets landing pages and one visual style; this version keeps the build-time directives and audit habit, adds workflow and state-continuity rules for product surfaces, and generalizes everything so it applies to any project, stack, or output medium.
---

# UI Quality

## Core standard

A surface is done only when its workflow and visual finish would make a
non-technical person trust it immediately. Working controls are not enough.
Mature products in the same category set the minimum bar, not an extra: if the
surface is a list, a form, a board, a report, or a terminal command, it must behave
at least as well as the best-known tools of that kind. Simpler means fewer
distractions and clearer decisions; it never means bare, generic, or under-designed.
Build the real working surface, not a prototype, a raw form, or a landing page.

## Workflow rules

- Make the primary action obvious within the first view without a tutorial. Put
  secondary actions behind clear buttons, menus, drawers, or dialogs.
- Destructive ceremony: delete, archive, remove, reset, revoke, and similar actions
  ask first, naming what will happen. Undo and restore stay direct.
- Errors are inline, specific, and say what to do next. Never use browser
  `alert`, `confirm`, or `prompt`; in a CLI, print a message and a non-zero exit.
- Design loading, empty, and error states with the same care as the happy path.
  Loading matches the final layout's shape; empty states say what belongs here and
  offer the first action.
- Keyboard and pointer both work for every interaction. Focus order follows the
  visual order and focus is always visible.
- Pickers, menus, and popovers close on Escape and on outside click. Where a choice
  is composed from several parts, provide explicit Cancel and Apply instead of
  committing on every keystroke.
- Creation, editing, renaming, and reordering happen where the person already is,
  with inline controls or a focused panel, not on a detour to a separate page.
- Everything fits the smallest supported viewport: no clipped text, hidden actions,
  or primary controls covered by navigation.

## State continuity

A person can leave a surface, do other work, and return without reconstructing
their view. Before building, inventory the durable working context: the open item,
view mode, filters, search, sort, selection, date range, pagination, expansion, and
meaningful scroll or work position. Restore it on return. Classify what must not
reopen: action menus, confirmation dialogs, partially completed destructive flows,
and unsafe unsaved drafts.

- Shareable or server-driven state belongs in the URL or the equivalent addressable
  form; personal view preferences belong in local storage scoped by person, area,
  and item so one item's settings never overwrite another's.
- Validate restored values against current permissions and current data. Ignore
  stale, malformed, inaccessible, or deleted selections safely.
- A local toggle updates in place; do not reload the whole surface when the data is
  already present.
- Server-saved data stays authoritative. View memory never shadows, duplicates, or
  overwrites business data.

## Visual finish

- Typography comes from the project's type scale or roles. Never introduce ad hoc
  pixel sizes. Build hierarchy with weight and size steps; sentence case for
  headings, labels, buttons, and menu items; tabular numerals for columns and counts.
- Color comes from the project's tokens or theme. When a token system exists, no raw
  hex, rgb, or hsl values in components. One accent; status colors from the
  semantic tokens only.
- Never pure black or pure white as a surface. Stay inside one neutral ladder and do
  not mix warm and cool grays.
- Spacing follows one consistent scale. Elements align to a grid; side-by-side
  panels share baselines, actions in card groups sit on one line, icons are
  optically aligned with their labels.
- Radii, borders, and shadows follow one ladder and imply one light direction.
- Interaction states are all designed: hover, focus-visible, active or pressed, and
  disabled. Focus rings are visible and consistent.
- Motion is brief and purposeful: 150 to 250 ms on state change, nothing
  scroll-driven, nothing decorative, nothing infinite.
- Wording is plain and specific: active voice, real draft copy, no lorem ipsum, no
  exclamation marks, no "Oops". Avoid AI copy cliches: elevate, seamless, unleash,
  next-gen, game-changer, delve, effortless, supercharge.
- For CLI output and generated documents the same rules apply in their medium:
  consistent indentation and column alignment, one heading scale, plain wording,
  and no color that carries meaning alone.

## Rejected moves

These belong to marketing pages, not to product surfaces: asymmetric heroes, three
equal feature cards, mesh or aurora gradients, glassmorphism, infinite
micro-animations, decorative noise or texture, scroll-pinned sections, oversized
display type, and purple-to-blue accents.

## Finalize audit

Run this on the diff of every UI change before asking for approval. Answer each
item yes or no; fix every no. If a fix changes what the operator sees, run
`node .staff-engineer/cli.mjs revise` and show the preview again. When a workflow
rule and a visual rule conflict, the workflow wins and the visual rule adapts.

1. The primary action is obvious in the first view.
2. Destructive actions ask first; undo and restore stay direct.
3. Errors are inline and specific; no browser alert, confirm, or prompt.
4. Loading, empty, and error states exist and match the layout.
5. Keyboard and pointer both complete every interaction; focus is visible.
6. Menus and pickers close on Escape and outside click; composed choices have
   Cancel and Apply.
7. Leaving and returning restores the working view; menus and unsafe drafts stay
   closed.
8. Every text style comes from the project's type scale; no ad hoc pixel sizes.
9. Only theme tokens are used; no raw hex, rgb, or hsl in components.
10. No pure black or pure white surfaces; one neutral family; one accent.
11. Spacing follows the scale and shared elements align across panels.
12. Hover, focus-visible, active, and disabled states exist and are consistent.
13. Nothing moves except on state change, and transitions are short.
14. Copy is real, plain, specific, and free of cliches.
15. The smallest and largest supported viewports were both checked on the live
    preview, and no rejected marketing move appears.

## Script backstop

```bash
node .staff-engineer/cli.mjs lifecycle
```

When `rules.ui.enabled` is `true` in `.staff-engineer/config.json`, or the toolkit
auto-detects a UI project, the staged lifecycle gate runs the UI rules on staged UI
files: browser dialogs, raw colors where a token system exists, arbitrary pixel
sizes, and `!important`. Fix findings. For a justified permanent case (a design
token file that must hold raw hex, for example) record an exception with
`node .staff-engineer/cli.mjs exception add --rule <id> --path <glob> --reason "..."`.

## Relationship to other skills

`simplify` runs after acceptance and may tighten UI code; if a simplification
changes what the operator sees, return to the preview loop. `handoff` reports UI
work in the operator's language: the visible outcome, where to see it, and whether
the smallest and largest viewports were checked, never implementation details
unless asked.
