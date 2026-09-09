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
import { layoutPlan, relax, SPACING } from './plan-diagram.js';

const NS = 'http://www.w3.org/2000/svg';
const make = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

const PAD = 30;
const BOX = { w: 150, h: 34 };

export function drawPlan(host, plan, { onPick, across = false, materials = false } = {}) {
  host.textContent = '';
  // The room a box needs depends on which way the picture runs, so the layout
  // is told before it starts rather than turned afterwards.
  const state = layoutPlan(plan, { ...(across ? SPACING.across : SPACING.down), materials });
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

  /**
   * A line through its waypoints, leaving and arriving straight.
   *
   * Sparr: the combing for the Columbite line is good but it needs tighter
   * curves at the end so it stops clipping the Hydrofluoric Acid. Control
   * points at the halfway mark make every segment a wide sweep, and the sweep
   * nearest a box is the one that bulges across whatever is beside it. Held to
   * a short reach instead -- a third of the step, and never more than forty --
   * the line leaves its box along the flow, runs where the comb put it, and
   * arrives the same way.
   */
  const thread = (stops) => {
    let d = `M ${stops[0].x} ${stops[0].y}`;
    for (let i = 1; i < stops.length; i++) {
      const p = stops[i - 1];
      const q = stops[i];
      const reach = Math.min(40, Math.abs(across ? q.y - p.y : q.x - p.x) / 3);
      d += across
        ? ` C ${p.x} ${p.y + reach}, ${q.x} ${q.y - reach}, ${q.x} ${q.y}`
        : ` C ${p.x + reach} ${p.y}, ${q.x - reach} ${q.y}, ${q.x} ${q.y}`;
    }
    return d;
  };

  // A quarter of the way from the first stop to the last.
  const nearSource = (stops) => {
    const a = stops[0];
    const b = stops[stops.length - 1];
    return { x: a.x + (b.x - a.x) / 4, y: a.y + (b.y - a.y) / 4 };
  };

  const drawn = [];
  for (const w of state.wires) {
    // Sparr: no arrow ends where lines come together at the invisible nodes.
    // A joint is a bend in the way, not something the line goes into.
    const line = make('path', { class: 'plan-wire' + (w.back ? ' plan-wire-loop' : '')
                                + (w.role ? ` plan-wire-${w.role}` : ''),
                                ...(w.join ? {} : { 'marker-end': 'url(#plan-arrow)' }) });
    wires.append(line);
    let tag = null;
    if (w.label) {
      /**
       * The material, written on the arrow that carries it.
       *
       * Sparr: put the material edge labels closer to the source end.
       *
       * At its middle waypoint if it has one, since that is a column the line
       * was given to itself; otherwise a quarter of the way along rather than
       * halfway, which is near enough the box it came out of to say which one
       * that was, and still clear of it.
       */
      tag = make('text', { class: 'plan-wire-label' });
      tag.textContent = w.label.length > 22 ? `${w.label.slice(0, 21)}…` : w.label;
      const full = make('title');
      full.textContent = w.label;
      tag.append(full);
      wires.append(tag);
    }
    drawn.push([w, line, tag]);
  }

  for (const n of state.nodes) {
    if (n.kind === 'bend') continue;                 // a place for a line to stand, not a thing
    const g = make('g', { class: `plan-node plan-${n.kind}`
      + (n.hold ? ' plan-hold' : '')
      + (n.pseudo ? ' plan-pseudo' : '') + (n.role ? ` plan-role-${n.role}` : '') });
    /**
     * A phase change is a joint, not a box: it holds the place its lines stop
     * at without spending a box on saying that steam is water when it cools.
     */
    if (n.hold) {
      g.append(make('circle', { class: 'plan-node-joint', cx: 0, cy: 0, r: 4 }));
      const full = make('title');
      full.textContent = `${n.runs}× ${n.name}`;
      g.append(full);
      boxes.append(g);
      n.el = g;
      continue;
    }
    g.append(make('rect', { class: 'plan-node-box', x: -BOX.w / 2, y: -BOX.h / 2,
                            width: BOX.w, height: BOX.h, rx: n.kind === 'step' ? 4 : 16 }));
    const label = make('text', { class: 'plan-node-label', x: 0, y: 4 });
    // Sparr: omit the reactor step counts from the nodes, keep the material
    // quantities. The arrows carry the amounts now.
    const shown = n.pseudo ? n.label : n.kind === 'step' ? n.label
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
    for (const [w, line, tag] of drawn) {
      const pts = w.points;
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (w.back) {
        // Read backwards, and now routed like everything else: it has standing
        // room in each column it crosses, so it can be threaded rather than
        // bowed hopefully over the top.
        const stops = [into(a), ...pts.slice(1, -1).map(mid), out(b)];
        line.setAttribute('d', thread(stops));
        if (tag) {
          const at = pts.length > 2 ? mid(pts[(pts.length - 1) >> 1])
            : nearSource(stops);
          tag.setAttribute('x', at.x);
          tag.setAttribute('y', at.y - 4);
        }
        continue;
      }
      const stops = [out(a), ...pts.slice(1, -1).map(mid), into(b)];
      line.setAttribute('d', thread(stops));
      if (tag) {
        const at = pts.length > 2 ? mid(pts[(pts.length - 1) >> 1])
          : nearSource(stops);
        tag.setAttribute('x', at.x);
        tag.setAttribute('y', at.y - 4);
      }
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
    if (moved > 0.01 && ticks < 600) frame(settle);
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
