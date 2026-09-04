#!/usr/bin/env node
// Generates docs/lifecycle-light.svg and docs/lifecycle-dark.svg. Run after changing
// the lifecycle: node docs/lifecycle-diagram.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const STAGES = [
  { title: "Agree", nodes: [
    { id: "begin", title: "begin", sub: "one concern at a time" },
    { id: "grill", title: "grill-me", sub: "interview the operator, three questions a round" },
    { id: "brief", title: "brief", sub: "outcome, acceptance checks, non-goals" },
  ] },
  { title: "Build", nodes: [
    { id: "code", title: "first working pass", sub: "SOLID; no tests yet" },
    { id: "preview", title: "preview", sub: "show the working result" },
    { id: "feedback", title: "operator feedback", kind: "decision" },
  ] },
  { title: "Finish", nodes: [
    { id: "tests", title: "tests" },
    { id: "simplify", title: "simplify", sub: "four-lens cleanup review" },
    { id: "docs", title: "docs" },
    { id: "gate", title: "lifecycle gate + verify", sub: "receipt for this exact code" },
  ] },
  { title: "Save", nodes: [
    { id: "handoff", title: "handoff", sub: "plain-language approval request" },
    { id: "approve", title: "“ship it”?", kind: "decision" },
    { id: "ship", title: "ship", sub: "one guarded commit", kind: "final" },
  ] },
];
const FLOW_LABELS = { feedback: "looks good", approve: "yes" };
const LOOPS = [
  { from: "feedback", to: "code", label: "change this", lane: 0 },
  { from: "approve", to: "tests", label: "hold", lane: 1 },
];

const PALETTES = {
  light: { bg: "transparent", band: "#f6f8fa", bandStroke: "#d0d7de", bandTitle: "#57606a", node: "#ffffff", nodeStroke: "#8c959f", text: "#1f2328", sub: "#57606a", decision: "#ddf4ff", decisionStroke: "#54aeff", final: "#dafbe1", finalStroke: "#4ac26b", arrow: "#57606a", label: "#57606a" },
  dark: { bg: "transparent", band: "#161b22", bandStroke: "#30363d", bandTitle: "#8b949e", node: "#0d1117", nodeStroke: "#6e7681", text: "#e6edf3", sub: "#8b949e", decision: "#0c2d6b", decisionStroke: "#388bfd", final: "#033a16", finalStroke: "#2ea043", arrow: "#8b949e", label: "#8b949e" },
};

const W = 460;
const NX = 40;
const NW = 300;
const NH = 52;
const GAP = 26;
const BAND_PAD_TOP = 34;
const BAND_PAD_BOTTOM = 14;
const BAND_GAP = 16;
const LANES = [388, 426];
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function layout() {
  const bands = [];
  const nodes = new Map();
  let y = 8;
  for (const stage of STAGES) {
    const bandTop = y;
    y += BAND_PAD_TOP;
    for (const node of stage.nodes) {
      nodes.set(node.id, { ...node, x: NX, y, w: NW, h: NH });
      y += NH + GAP;
    }
    y -= GAP;
    y += BAND_PAD_BOTTOM;
    bands.push({ title: stage.title, top: bandTop, bottom: y });
    y += BAND_GAP;
  }
  return { bands, nodes, height: y - BAND_GAP + 8 };
}

function render(palette) {
  const { bands, nodes, height } = layout();
  const p = PALETTES[palette];
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-labelledby="title desc" font-family="${FONT}">`);
  out.push(`<title id="title">The staff-engineer lifecycle</title>`);
  out.push(`<desc id="desc">Agree: begin, grill-me, brief. Build: first working pass, preview, operator feedback (change requests loop back). Finish: tests, simplify, docs, lifecycle gate and verify. Save: handoff, ship it approval (hold loops back to finishing), ship as one commit.</desc>`);
  out.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${p.arrow}"/></marker></defs>`);

  for (const band of bands) {
    out.push(`<rect x="8" y="${band.top}" width="${W - 16}" height="${band.bottom - band.top}" rx="12" fill="${p.band}" stroke="${p.bandStroke}"/>`);
    out.push(`<text x="24" y="${band.top + 22}" font-size="12" font-weight="700" letter-spacing="1.5" fill="${p.bandTitle}">${band.title.toUpperCase()}</text>`);
  }

  // Main flow arrows between consecutive nodes.
  const order = STAGES.flatMap((stage) => stage.nodes.map((node) => node.id));
  for (let index = 0; index < order.length - 1; index += 1) {
    const from = nodes.get(order[index]);
    const to = nodes.get(order[index + 1]);
    const x = from.x + from.w / 2;
    out.push(`<line x1="${x}" y1="${from.y + from.h}" x2="${x}" y2="${to.y - 1}" stroke="${p.arrow}" stroke-width="1.6" marker-end="url(#arrow)"/>`);
    const label = FLOW_LABELS[from.id];
    if (label) out.push(`<text x="${x + 10}" y="${(from.y + from.h + to.y) / 2 + 4}" font-size="12" font-style="italic" fill="${p.label}">${label}</text>`);
  }

  // Loops back up the right side.
  for (const loop of LOOPS) {
    const from = nodes.get(loop.from);
    const to = nodes.get(loop.to);
    const lane = LANES[loop.lane];
    const y1 = from.y + from.h / 2;
    const y2 = to.y + to.h / 2;
    const path = `M ${from.x + from.w} ${y1} H ${lane} V ${y2} H ${to.x + to.w + 2}`;
    out.push(`<path d="${path}" fill="none" stroke="${p.arrow}" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#arrow)"/>`);
    const ly = (y1 + y2) / 2;
    out.push(`<text x="${lane + 13}" y="${ly}" font-size="12" font-style="italic" fill="${p.label}" text-anchor="middle" transform="rotate(-90 ${lane + 13} ${ly})">${loop.label}</text>`);
  }

  for (const node of nodes.values()) {
    const fill = node.kind === "decision" ? p.decision : node.kind === "final" ? p.final : p.node;
    const stroke = node.kind === "decision" ? p.decisionStroke : node.kind === "final" ? p.finalStroke : p.nodeStroke;
    const rx = node.kind === "decision" ? NH / 2 : 10;
    out.push(`<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`);
    const cx = node.x + node.w / 2;
    const cy = node.y + node.h / 2;
    if (node.sub) {
      out.push(`<text x="${cx}" y="${cy - 4}" font-size="16" font-weight="600" text-anchor="middle" fill="${p.text}">${escape(node.title)}</text>`);
      out.push(`<text x="${cx}" y="${cy + 15}" font-size="12" text-anchor="middle" fill="${p.sub}">${escape(node.sub)}</text>`);
    } else {
      out.push(`<text x="${cx}" y="${cy + 6}" font-size="16" font-weight="600" text-anchor="middle" fill="${p.text}">${escape(node.title)}</text>`);
    }
  }
  out.push("</svg>");
  return `${out.join("\n")}\n`;
}

function escape(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

for (const palette of Object.keys(PALETTES)) {
  writeFileSync(join(here, `lifecycle-${palette}.svg`), render(palette), "utf8");
}
console.log("wrote docs/lifecycle-light.svg and docs/lifecycle-dark.svg");
