/**
 * The layout, drawn, and left in the reader's hands.
 *
 * Everything decided in `plan-diagram.js` is arithmetic on numbers; this is
 * the part that makes marks and takes presses. Kept apart because the layout
 * is worth testing and a drag handler is not: the sums can be checked without
 * a browser, and what is left here is short enough to read.
 *
 * Drawn as SVG rather than boxes on the page because the arrows are the point.
 * A plan is a graph and the interesting question -- where does this material
 * come from and what is waiting on it -- is a question about edges.
 */
import { layoutPlan, relax } from './plan-diagram.js';

const NS = 'http://www.w3.org/2000/svg';
const make = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

const PAD = 28;
const BOX = { w: 150, h: 34 };

/**
 * Where an edge meets a node.
 *
 * At the side rather than the centre, so a line does not disappear under the
 * label it is pointing at and the arrowheads all land on one vertical.
 */
const port = (n, side) => ({ x: n.x + (side === 'out' ? BOX.w / 2 : -BOX.w / 2), y: n.y });

/**
 * A curve rather than a straight line.
 *
 * Two edges between the same pair of columns lie on top of each other when
 * both are straight and their ends are level; bowed apart by where they are
 * going, they stay legible. The loop-closing edges bow the other way and are
 * dashed, since they are the only ones that read right to left.
 */
function path(a, b, back) {
  const from = port(a, back ? 'in' : 'out');
  const to = port(b, back ? 'out' : 'in');
  const lift = back ? -46 : 0;
  const mid = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} C ${mid} ${from.y + lift}, ${mid} ${to.y + lift}, ${to.x} ${to.y}`;
}

export function drawPlan(host, plan, { onPick } = {}) {
  host.textContent = '';
  const state = layoutPlan(plan);
  if (!state.nodes.length) {
    host.append(Object.assign(document.createElement('p'), {
      className: 'muted', textContent: 'Nothing to draw yet.' }));
    return { stop() {} };
  }

  const svg = make('svg', { class: 'plan-svg' });
  const defs = make('defs');
  const arrow = make('marker', { id: 'plan-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4,
                                 markerWidth: 6, markerHeight: 6, orient: 'auto' });
  arrow.append(make('path', { d: 'M 0 0 L 8 4 L 0 8 z', class: 'plan-arrowhead' }));
  defs.append(arrow);
  svg.append(defs);

  const wires = make('g', { class: 'plan-wires' });
  const boxes = make('g', { class: 'plan-boxes' });
  svg.append(wires, boxes);

  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const drawn = new Map();
  for (const e of state.edges) {
    const line = make('path', { class: 'plan-wire' + (e.back ? ' plan-wire-loop' : ''),
                                'marker-end': 'url(#plan-arrow)' });
    wires.append(line);
    drawn.set(e, line);
  }

  for (const n of state.nodes) {
    const g = make('g', { class: `plan-node plan-${n.kind}` + (n.role ? ` plan-role-${n.role}` : '') });
    g.append(make('rect', { class: 'plan-node-box', x: -BOX.w / 2, y: -BOX.h / 2,
                            width: BOX.w, height: BOX.h, rx: n.kind === 'step' ? 4 : 16 }));
    const label = make('text', { class: 'plan-node-label', x: 0, y: 4 });
    const shown = n.kind === 'step' ? `${n.runs}× ${n.label}`
      : (n.amount !== null && n.amount !== undefined ? `${n.amount} ${n.label}` : n.label);
    label.textContent = shown.length > 24 ? `${shown.slice(0, 23)}…` : shown;
    const full = make('title');
    full.textContent = shown;
    g.append(label, full);
    boxes.append(g);
    n.el = g;
    if (onPick && n.kind === 'material') {
      g.addEventListener('click', () => { if (!n.dragged) onPick(n.name); });
    }
  }

  const draw = () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of state.nodes) { lo = Math.min(lo, n.y); hi = Math.max(hi, n.y); }
    for (const n of state.nodes) n.el.setAttribute('transform', `translate(${n.x},${n.y})`);
    for (const [e, line] of drawn) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (a && b) line.setAttribute('d', path(a, b, e.back));
    }
    const w = state.width + BOX.w + PAD * 2;
    const h = (hi - lo) + BOX.h + PAD * 2;
    svg.setAttribute('viewBox', `${-BOX.w / 2 - PAD} ${lo - BOX.h / 2 - PAD} ${w} ${h}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
  };

  /**
   * The springs, run until they stop mattering.
   *
   * Layout put everything on a grid, which is tidy and a little dead: two
   * nodes joined across four columns sit at whatever height their own layer
   * gave them, and the line between them slopes for no reason. A few hundred
   * ticks of pulling joined things level takes most of that out. It stops when
   * nothing is moving, so an untouched picture costs a few frames and then
   * nothing at all.
   */
  /**
   * Asked for where there is a screen refresh to hang it on, and skipped where
   * there is not -- the headless shim has no frames, and a picture that is
   * merely drawn once is exactly what a test wants to look at.
   */
  const frame = globalThis.requestAnimationFrame?.bind(globalThis) ?? null;
  let alive = true;
  let ticks = 0;
  const settle = () => {
    if (!alive || !frame) return;
    const moved = relax(state);
    draw();
    ticks += 1;
    if (moved > 0.4 && ticks < 600) frame(settle);
  };

  // --- dragging ------------------------------------------------------------
  //
  // Both axes, because the reader's picture of their own factory beats the
  // one the ranking came up with. The springs only ever move things along
  // their column, so a node dragged sideways stays where it was put.
  let holding = null;
  const at = (ev) => {
    const box = svg.getBoundingClientRect();
    const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    return { x: vb[0] + (ev.clientX - box.left) / box.width * vb[2],
             y: vb[1] + (ev.clientY - box.top) / box.height * vb[3] };
  };
  svg.addEventListener('pointerdown', (ev) => {
    const g = ev.target.closest?.('.plan-node');
    if (!g) return;
    holding = state.nodes.find((n) => n.el === g);
    if (!holding) return;
    holding.held = true;
    holding.dragged = false;
    svg.setPointerCapture?.(ev.pointerId);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!holding) return;
    const p = at(ev);
    holding.x = p.x;
    holding.y = p.y;
    holding.dragged = true;
    draw();
    if (ticks >= 600) { ticks = 0; if (frame) frame(settle); }
  });
  const drop = () => {
    if (!holding) return;
    holding.held = false;
    holding = null;
    ticks = 0;
    if (frame) frame(settle);
  };
  svg.addEventListener('pointerup', drop);
  svg.addEventListener('pointercancel', drop);

  host.append(svg);
  draw();
  if (frame) frame(settle);
  return { stop() { alive = false; }, state };
}
