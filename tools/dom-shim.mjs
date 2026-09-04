/**
 * The smallest DOM that src/main.js needs, so the render path can be exercised
 * in Node.  This checks logic, not layout -- CSS still has to be eyeballed.
 */
class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...c) { c.forEach((x) => x && this.set.add(x)); this.sync(); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); this.sync(); }
  contains(c) { return this.set.has(c); }
  sync() { this.node._class = [...this.set].join(' '); }
}

class Node {
  constructor(tag) {
    this.tagName = (tag || '').toUpperCase();
    this.childNodes = [];
    this.attrs = new Map();
    this.dataset = {};
    this.style = { setProperty(k, v) { this[k] = v; } };
    this.listeners = new Map();
    this._class = '';
    this._text = '';
    this.classList = new ClassList(this);
  }
  get className() { return this._class; }
  set className(v) {
    this._class = v || '';
    this.classList.set = new Set(String(v || '').split(/\s+/).filter(Boolean));
  }
  get children() { return this.childNodes.filter((n) => n instanceof Node); }
  get textContent() {
    if (!this.childNodes.length) return this._text;
    return this.childNodes.map((n) => (n instanceof Node ? n.textContent : String(n.text ?? n))).join('');
  }
  set textContent(v) { this.childNodes = []; this._text = String(v); }
  set innerHTML(v) { this._text = String(v).replace(/<[^>]*>/g, ''); this.childNodes = []; }
  get innerHTML() { return this._text; }
  append(...nodes) {
    for (const n of nodes) {
      if (n instanceof Fragment) this.childNodes.push(...n.childNodes);
      else if (n instanceof Node) this.childNodes.push(n);
      else if (n && typeof n === 'object' && 'text' in n) this.childNodes.push(n);
      else this.childNodes.push({ text: String(n) });   // browsers stringify null
    }
  }
  appendChild(n) { this.append(n); return n; }
  remove() {}
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatch(type, ev = {}) {
    for (const fn of this.listeners.get(type) || []) fn({ target: this, preventDefault() {}, ...ev });
  }
  scrollIntoView() {}
  focus() {} blur() {} select() {}
  /** Depth-first walk, for assertions. */
  *walk() { yield this; for (const c of this.children) yield* c.walk(); }
}

class Fragment extends Node {}

export function installDom(idsFromHtml) {
  const byId = new Map();
  for (const id of idsFromHtml) {
    const n = new Node('div');
    n.id = id;
    if (id === 'q') { n.tagName = 'INPUT'; n.value = ''; }
    byId.set('#' + id, n);
  }
  // Just enough canvas for src/pattern-render.js to produce a strip. It draws
  // nothing; what matters is that the code path runs and returns a data URI, so
  // the styles that depend on it can be asserted.
  const makeCanvas = () => {
    const node = new Node('canvas');
    node.width = node.height = 0;
    node.getContext = () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
      drawImage() {},
    });
    node.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
    return node;
  };

  const document = {
    createElement: (t) => (t === 'canvas' ? makeCanvas() : new Node(t)),
    createDocumentFragment: () => new Fragment(),
    createTextNode: (t) => ({ text: String(t) }),
    querySelector: (sel) => byId.get(sel) ?? null,
    addEventListener() {},
    body: new Node('body'),
  };
  globalThis.document = document;
  globalThis.Node = Node;
  globalThis.CSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
  globalThis.performance = globalThis.performance || { now: () => 0 };
  globalThis.location = { hash: '' };
  globalThis.history = {
    pushState(_a, _b, h) { globalThis.location.hash = h.trim(); },
    replaceState(_a, _b, h) { globalThis.location.hash = h.trim(); },
  };
  globalThis.window = { addEventListener() {} };
  return { byId, Node };
}
