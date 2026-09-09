/**
 * The layout, drawn, and left in the reader's hands.
 *
 * Everything decided in `plan-diagram.js` is arithmetic on numbers; this is
 * the part that makes marks and takes presses. Kept apart because the layout
 * is worth testing and a drag handler is not.
 *
 * Drawn as SVG rather than boxes on the page because the arrows are the point.
 * A plan is a graph, and the question a reader has -- where does this come
 * from, what is waiting on it -- is a question about edges.
 */
import { layoutPlan, relax } from './plan-diagram.js';

const NS = 'http://www.w3.org/2000/svg';
const make = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

const PAD = 30;
const BOX = { w: 150, h: 34 };

export function drawPlan(host, plan, { onPick, across = false } = {}) {
  host.textContent = '';
  const state = layoutPlan(plan);
  if (!state.nodes.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Nothing to draw yet.';
    host.append(empty);
    return { stop() {}, state };
  }

  /**
   * Which way round the picture runs.
   *
   * Sparr: most plans will fit better as rows than columns. They will -- a
   * chain of twenty reactions is a long thin thing, and a page scrolls
   * downwards. Only the drawing turns: the layering, the combing and the
   * springs all still work along the same axis they always did, and this
   * swaps the two on the way to the screen and back again on the way from the
   * pointer. Nothing downstream of here knows which way it is being read.
   */
  const sx = (n) => (across ? n.y : n.x);
  const sy = (n) => (across ? n.x : n.y);

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

  /**
   * Where an arrow leaves a box and where it arrives.
   *
   * At the edge rather than the centre, on whichever side the flow is going,
   * so a line never disappears under the label it is pointing at.
   */
  const half = () => (across ? BOX.h / 2 : BOX.w / 2);
  const out = (n) => (across ? { x: sx(n), y: sy(n) + half() } : { x: sx(n) + half(), y: sy(n) });
  const into = (n) => (across ? { x: sx(n), y: sy(n) - half() } : { x: sx(n) - half(), y: sy(n) });
  const mid = (n) => ({ x: sx(n), y: sy(n) });

  const drawn = [];
  for (const w of state.wires) {
    const line = make('path', { class: 'plan-wire' + (w.back ? ' plan-wire-loop' : ''),
                                'marker-end': 'url(#plan-arrow)' });
    wires.append(line);
    drawn.push([w, line]);
  }

  for (const n of state.nodes) {
    if (n.kind === 'bend') continue;                 // a place for a line to stand, not a thing
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

  /**
   * The frame the picture is seen through, held still while a node is moved.
   *
   * Recomputed every tick it drifted, and a drag reads the pointer through it
   * -- so dragging a node past the old edge grew the frame, which moved
   * everything, which moved the node under the pointer. It looked like the
   * node was snapping to somewhere it had not been put. The box is worked out
   * when nothing is being held and left alone while something is.
   */
  let view = null;
  const reframe = () => {
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const n of state.nodes) {
      x0 = Math.min(x0, sx(n)); x1 = Math.max(x1, sx(n));
      y0 = Math.min(y0, sy(n)); y1 = Math.max(y1, sy(n));
    }
    view = { x: x0 - BOX.w / 2 - PAD, y: y0 - BOX.h / 2 - PAD,
             w: (x1 - x0) + BOX.w + PAD * 2, h: (y1 - y0) + BOX.h + PAD * 2 };
  };

  const draw = () => {
    if (!holding || !view) reframe();
    for (const n of state.nodes) {
      if (n.el) n.el.setAttribute('transform', `translate(${sx(n)},${sy(n)})`);
    }
    for (const [w, line] of drawn) {
      const pts = w.points;
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (w.back) {
        // The one arrow that reads backwards, bowed clear of everything else.
        const from = into(a);
        const to = out(b);
        const lift = across ? 0 : -46;
        const shift = across ? -46 : 0;
        const cx = (from.x + to.x) / 2 + shift;
        const cy = (from.y + to.y) / 2 + lift;
        line.setAttribute('d', `M ${from.x} ${from.y} C ${cx} ${from.y + lift}, ${cx} ${to.y + lift}, ${to.x} ${to.y}`);
        continue;
      }
      const stops = [out(a), ...pts.slice(1, -1).map(mid), into(b)];
      let d = `M ${stops[0].x} ${stops[0].y}`;
      for (let i = 1; i < stops.length; i++) {
        const p = stops[i - 1];
        const q = stops[i];
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        d += across ? ` C ${p.x} ${my}, ${q.x} ${my}, ${q.x} ${q.y}`
                    : ` C ${mx} ${p.y}, ${mx} ${q.y}, ${q.x} ${q.y}`;
      }
      line.setAttribute('d', d);
    }
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    svg.setAttribute('width', view.w);
    svg.setAttribute('height', view.h);
  };

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

  let holding = null;
  const at = (ev) => {
    const box = svg.getBoundingClientRect?.();
    if (!box || !view) return { x: 0, y: 0 };
    return { x: view.x + (ev.clientX - box.left) / box.width * view.w,
             y: view.y + (ev.clientY - box.top) / box.height * view.h };
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
    if (across) { holding.y = p.x; holding.x = p.y; } else { holding.x = p.x; holding.y = p.y; }
    holding.dragged = true;
    draw();
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
