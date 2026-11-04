import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import * as core from '../js/core.js';
import * as catalog from '../js/catalog.js';

const APP_PATH = new URL('../js/app.js', import.meta.url);
const HTML_PATH = new URL('../index.html', import.meta.url);
const [appSource, htmlSource] = await Promise.all([
  readFile(APP_PATH, 'utf8'),
  readFile(HTML_PATH, 'utf8'),
]);

// The production imports remain real imports above; only those two static lines
// are removed from the source copied into the VM. The bootstrap calls are also
// removed from this test copy, never from public/js/app.js.
const vmSource = appSource
  .replace(/^import \{[^\n]+\} from '[^']+';\n/gm, '')
  .replace(/initializeFirebase\(\); registerWorker\(\);\s*$/m, '');

class MockClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set((element.attributes.class || '').split(/\s+/).filter(Boolean));
  }

  add(...tokens) {
    tokens.filter(Boolean).forEach(token => this.values.add(token));
  }

  remove(...tokens) {
    tokens.forEach(token => this.values.delete(token));
  }

  contains(token) {
    return this.values.has(token);
  }

  toggle(token, force) {
    const next = force === undefined ? !this.values.has(token) : Boolean(force);
    if (next) this.values.add(token); else this.values.delete(token);
    return next;
  }

  toString() {
    return [...this.values].join(' ');
  }
}

class MockElement {
  constructor(document, tagName = 'div', attributes = {}) {
    this.ownerDocument = document;
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.classList = new MockClassList(this);
    this.style = {};
    this.children = [];
    this.listeners = new Map();
    this.value = '';
    this.textContent = '';
    this._innerHTML = '';
    this.hidden = false;
    this.disabled = false;
    this.inert = false;
    this.type = attributes.type || '';
    this.onclick = null;
  }

  get id() {
    return this.attributes.id || '';
  }

  set id(value) {
    this.attributes.id = String(value);
  }

  get dataset() {
    return Object.fromEntries(Object.entries(this.attributes)
      .filter(([key]) => key.startsWith('data-'))
      .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    if (this.tagName === 'SELECT') {
      const previous = this.value;
      const options = [...this._innerHTML.matchAll(/<option\b[^>]*\bvalue=["']([^"']*)["'][^>]*>/gi)].map(match => match[1]);
      this.value = options.includes(previous) ? previous : (options[0] || '');
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
    this._innerHTML = '';
    if (this.tagName === 'SELECT') this.value = '';
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {} });
    this.onclick?.({ type: 'click', target: this, preventDefault() {} });
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  remove() {
    this.removed = true;
  }

  closest(selector) {
    if (selector === '[data-action]' && this.hasAttribute('data-action')) return this;
    if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) return this;
    return null;
  }

  getContext(kind) {
    if (this.tagName !== 'CANVAS' || kind !== '2d') return null;
    if (!this.context2d) {
      const noop = () => {};
      this.context2d = {
        setTransform: noop,
        clearRect: noop,
        beginPath: noop,
        arc: noop,
        stroke: noop,
        moveTo: noop,
        lineTo: noop,
        closePath: noop,
        fill: noop,
        set strokeStyle(_) {},
        set lineWidth(_) {},
        set fillStyle(_) {},
      };
    }
    return this.context2d;
  }
}

function matchesSelector(element, selector) {
  let value = selector.trim();
  if (!value) return false;
  const notDisabled = value.includes(':not(:disabled)');
  value = value.replace(':not(:disabled)', '');
  if (notDisabled && element.disabled) return false;
  if (value === '*') return true;
  if (value === '[data-action]') return element.hasAttribute('data-action');
  if (value === '[data-eixo]') return element.hasAttribute('data-eixo');
  if (value.startsWith('#')) return element.id === value.slice(1);
  if (value.startsWith('.')) return value.slice(1).split('.').every(className => element.classList.contains(className));
  const tagClass = value.match(/^([a-z0-9-]+)?\.([a-z0-9_-]+)$/i);
  if (tagClass) return (!tagClass[1] || element.tagName.toLowerCase() === tagClass[1].toLowerCase())
    && element.classList.contains(tagClass[2]);
  const tag = value.match(/^[a-z0-9-]+$/i);
  if (tag) return element.tagName.toLowerCase() === value.toLowerCase();
  return false;
}

class MockDocument {
  constructor(source) {
    this.elements = [];
    this.byId = new Map();
    this.listeners = new Map();
    this.body = new MockElement(this, 'body');
    this.activeElement = this.body;
    const tagPattern = /<([a-z][a-z0-9-]*)(\s[^>]*?)?\s*\/?>/gi;
    const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
    for (const match of source.matchAll(tagPattern)) {
      const attributes = {};
      for (const attr of (match[2] || '').matchAll(attributePattern)) {
        attributes[attr[1]] = attr[2] ?? attr[3] ?? '';
      }
      const element = new MockElement(this, match[1], attributes);
      this.elements.push(element);
      if (element.id) this.byId.set(element.id, element);
    }
  }

  getElementById(id) {
    return this.byId.get(id) || null;
  }

  createElement(tagName) {
    return new MockElement(this, tagName);
  }

  querySelectorAll(selectorList) {
    const selectors = selectorList.split(',').map(selector => selector.trim()).filter(Boolean);
    return this.elements.filter(element => selectors.some(selector => matchesSelector(element, selector)));
  }

  querySelector(selectorList) {
    return this.querySelectorAll(selectorList)[0] || null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
  }
}

class MockStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }

  clear() {
    this.values.clear();
  }
}

class MockStore {
  constructor() {
    this.getDocsQueue = [];
    this.queries = [];
    this.writes = [];
    this.collections = [];
    this.Timestamp = { now: () => new Date() };
  }

  where(field, operator, value) {
    return { kind: 'where', field, operator, value };
  }

  orderBy(field, direction) {
    return { kind: 'orderBy', field, direction };
  }

  startAfter(cursor) {
    return { kind: 'startAfter', cursor };
  }

  limit(value) {
    return { kind: 'limit', value };
  }

  collection(db, name) {
    const reference = { db, name };
    this.collections.push(reference);
    return reference;
  }

  query(collection, ...constraints) {
    const query = { collection, constraints };
    this.queries.push(query);
    return query;
  }

  async getDocs(query) {
    this.lastReadQuery = query;
    const next = this.getDocsQueue.shift();
    if (typeof next === 'function') return next(query);
    if (next instanceof Error) throw next;
    return next || { docs: [] };
  }

  doc(db, collection, id) {
    return { db, collection, id };
  }

  async addDoc(reference, value) {
    this.writes.push({ type: 'addDoc', reference, value });
    return { id: `written-${this.writes.length}` };
  }

  async updateDoc(reference, value) {
    this.writes.push({ type: 'updateDoc', reference, value });
  }

  async deleteDoc(reference) {
    this.writes.push({ type: 'deleteDoc', reference });
  }
}

function snapshot(entries) {
  return {
    docs: entries.map(entry => ({
      id: entry.id,
      data: () => ({ ...entry }),
    })),
  };
}

function makeEntry(id, uid = 'user-1', overrides = {}) {
  return {
    id,
    uid,
    headline: `Manchete ${id}`,
    lead: `Resumo ${id}`,
    palavra: 'presença',
    gratidoes: ['o café', 'a família'],
    eixos: ['Família'],
    createdAt: new Date(Date.now() - 2 * 86400000),
    ...overrides,
  };
}

function createHarness() {
  const document = new MockDocument(htmlSource);
  const storage = new MockStorage();
  const store = new MockStore();
  let signOutCalls = 0;
  const authApi = {
    signOut: async () => { signOutCalls += 1; },
  };
  const auth = { name: 'mock-auth' };
  const db = { name: 'mock-db' };
  const mediaQuery = { matches: false, addEventListener() {} };
  const context = vm.createContext({
    console,
    document,
    location: { pathname: '/index.html', reload() {} },
    sessionStorage: storage,
    navigator: { clipboard: { async writeText() {} } },
    URL,
    Blob,
    Date,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    devicePixelRatio: 1,
    matchMedia: () => mediaQuery,
  });
  context.addEventListener = () => {};
  context.window = context;
  context.__store = store;
  context.__auth = auth;
  context.__authApi = authApi;
  context.__db = db;
  Object.assign(context, core, catalog, { esc: core.escapeHtml });
  vm.runInContext(vmSource, context, { filename: 'public/js/app.js (VM)' });

  function run(code) {
    return vm.runInContext(code, context, { filename: 'tests/app.test.js (VM)' });
  }

  function expose(name, value) {
    context[name] = value;
  }

  function setSession(user, entries = [], demo = false) {
    expose('__user', user);
    expose('__entries', entries);
    run(`resetSession(); auth = __auth; authApi = __authApi; db = __db; storeApi = __store; currentUser = __user; allEntries = __entries; demoMode = ${demo ? 'true' : 'false'};`);
  }

  return {
    context,
    document,
    store,
    storage,
    auth,
    get signOutCalls() { return signOutCalls; },
    el(id) {
      const element = document.getElementById(id);
      assert.ok(element, `elemento #${id} ausente no mock DOM`);
      return element;
    },
    run,
    expose,
    setSession,
    get(name) {
      return run(name);
    },
  };
}

test('demonstração não grava dados e navega por todas as telas', () => {
  const harness = createHarness();

  harness.run('window.startDemo()');
  assert.equal(harness.get('demoMode'), true);
  assert.equal(harness.get('allEntries').length, 5);
  assert.equal(harness.store.writes.length, 0);
  assert.equal(harness.el('demo-notice').hidden, false);
  assert.equal(harness.get('activeScreen'), 'home');
  assert.match(harness.el('entries-list').innerHTML, /entry-card/);

  for (const screen of ['entry', 'search', 'report', 'month', 'home']) {
    harness.run(`window.goTo('${screen}')`);
    assert.equal(harness.get('activeScreen'), screen);
    assert.equal(harness.el(`screen-${screen}`).classList.contains('active'), true);
  }
  assert.equal(harness.el('nav-month').classList.contains('active'), false);
  harness.run("window.goTo('month')");
  assert.notEqual(harness.el('month-select').value, '');
  assert.match(harness.el('month-entries').innerHTML, /month-entry/);
});

test('card, mês e relatórios escapam payload HTML', () => {
  const harness = createHarness();
  harness.run('window.startDemo()');
  const malicious = makeEntry('xss-1', 'demo-local', {
    headline: '"><script>alert(1)</script>',
    lead: '<img src=x onerror=alert(1)>',
    palavra: '</span><svg onload=alert(1)>',
    gratidoes: ['<b>segredo</b>', 'café tranquilo'],
    eixos: ['Saúde e Disposição', '<img src=x onerror=1>'],
    createdAt: new Date(),
  });
  harness.expose('__entries', [malicious]);
  harness.run('allEntries = __entries; goTo("home")');
  assert.doesNotMatch(harness.el('entries-list').innerHTML, /<(?:script|img|svg)\b/i);
  assert.match(harness.el('entries-list').innerHTML, /&lt;script&gt;/);

  harness.run('goTo("month")');
  assert.doesNotMatch(harness.el('month-entries').innerHTML, /<(?:script|img|svg)\b/i);
  assert.match(harness.el('month-entries').innerHTML, /&lt;img/);

  harness.run('goTo("report")');
  assert.doesNotMatch(harness.el('report-headlines').innerHTML, /<(?:script|img|svg)\b/i);
  assert.match(harness.el('report-headlines').innerHTML, /&lt;script&gt;/);
});

test('edição atualiza palavra/eixos e rejeita edição sem gratidão', async () => {
  const harness = createHarness();
  harness.run('window.startDemo()');
  harness.run('window.openEdit("demo-0")');
  harness.el('edit-palavra').value = 'renovação';
  const axis = harness.document.querySelectorAll('.edit-eixo-chip')
    .find(chip => chip.dataset.eixo === 'Saúde e Disposição');
  assert.ok(axis);
  axis.click();
  await harness.run('window.saveEdit()');

  const edited = harness.get('allEntries').find(entry => entry.id === 'demo-0');
  assert.equal(edited.palavra, 'renovação');
  assert.ok(edited.eixos.includes('Saúde e Disposição'));
  assert.equal(harness.el('edit-modal').classList.contains('hidden'), true);
  assert.equal(harness.store.writes.length, 0);

  harness.run('window.openEdit("demo-0")');
  for (const id of ['edit-grat1', 'edit-grat2', 'edit-grat3']) harness.el(id).value = '';
  await harness.run('window.saveEdit()');
  assert.equal(harness.el('edit-modal').classList.contains('hidden'), false);
  assert.equal(harness.el('edit-grat1').getAttribute('aria-invalid'), 'true');
  assert.match(harness.el('toast').textContent, /gratidão/i);
});

test('exclusão usa o identificador estável do documento', async () => {
  const harness = createHarness();
  const first = makeEntry('stable-a', 'user-delete', { headline: 'mesma manchete' });
  const second = makeEntry('stable-b', 'user-delete', { headline: 'mesma manchete' });
  harness.setSession({ uid: 'user-delete', displayName: 'Pessoa' }, [first, second]);

  harness.run('window.askDelete("stable-b")');
  assert.equal(harness.el('confirm-modal').classList.contains('hidden'), false);
  await harness.run('window.confirmDelete()');

  assert.deepEqual(harness.store.writes.map(write => write.type), ['deleteDoc']);
  assert.equal(harness.store.writes[0].reference.id, 'stable-b');
  assert.deepEqual(harness.get('allEntries').map(entry => entry.id), ['stable-a']);
});

test('logout limpa campos privados, rascunho e estado da sessão', async () => {
  const harness = createHarness();
  const user = { uid: 'user-logout', displayName: 'Ana Pessoa' };
  harness.setSession(user, [makeEntry('private-1', user.uid)]);
  harness.el('user-bar').style.display = 'flex';
  harness.el('bottom-nav').style.display = 'flex';
  harness.el('user-name-label').textContent = 'Ana';
  for (const id of ['inp-headline', 'inp-lead', 'grat-1', 'grat-2', 'grat-3', 'inp-palavra', 'edit-headline', 'edit-lead', 'edit-palavra', 'edit-grat1', 'edit-grat2', 'edit-grat3', 'search-input', 'search-from', 'search-to']) {
    harness.el(id).value = 'privado';
  }
  harness.el('search-eixo').value = 'Família';
  harness.el('edit-eixos').querySelectorAll?.('.edit-eixo-chip');
  harness.el('edit-modal').classList.remove('hidden');
  harness.storage.setItem('chama-draft:/index.html:user-logout', '{"headline":"privado"}');

  await harness.run('window.signOut()');

  assert.equal(harness.signOutCalls, 1);
  assert.equal(harness.get('currentUser'), null);
  assert.deepEqual(Array.from(harness.get('allEntries')), []);
  assert.equal(harness.get('demoMode'), false);
  assert.equal(harness.get('activeScreen'), 'auth');
  for (const id of ['inp-headline', 'inp-lead', 'grat-1', 'grat-2', 'grat-3', 'inp-palavra', 'edit-headline', 'edit-lead', 'edit-palavra', 'edit-grat1', 'edit-grat2', 'edit-grat3', 'search-input', 'search-from', 'search-to']) {
    assert.equal(harness.el(id).value, '', `#${id} deveria estar limpo`);
  }
  assert.equal(harness.el('search-eixo').value, '');
  assert.equal(harness.el('user-bar').style.display, 'none');
  assert.equal(harness.el('bottom-nav').style.display, 'none');
  assert.equal(harness.el('entries-list').innerHTML, '');
  assert.equal(harness.storage.getItem('chama-draft:/index.html:user-logout'), null);
});

test('erro de histórico preserva entradas e permite tentar novamente', async () => {
  const harness = createHarness();
  const oldEntry = makeEntry('already-loaded', 'user-retry');
  const replacement = makeEntry('loaded-after-retry', 'user-retry', { createdAt: new Date() });
  harness.setSession({ uid: 'user-retry', displayName: 'Retry' }, [oldEntry]);
  const failure = Object.assign(new Error('offline'), { code: 'unavailable' });
  harness.store.getDocsQueue.push(failure, snapshot([replacement]));

  await harness.run('loadEntries()');
  assert.deepEqual(harness.get('allEntries').map(entry => entry.id), ['already-loaded']);
  assert.match(harness.get('historyError'), /carregar seu histórico/i);
  assert.equal(harness.el('history-load-more').hidden, false);
  assert.equal(harness.el('history-load-more').textContent, 'Tentar novamente');

  await harness.el('history-load-more').onclick();
  assert.deepEqual(Array.from(harness.get('allEntries').map(entry => entry.id)), ['loaded-after-retry']);
  assert.equal(harness.get('historyError'), '');
  assert.match(harness.el('history-note').textContent, /1 registro/);
  assert.equal(harness.store.queries.length, 2);
});

test('resposta antiga é descartada depois da troca de sessão', async () => {
  const harness = createHarness();
  harness.setSession({ uid: 'session-a', displayName: 'A' }, []);
  let resolveOld;
  harness.store.getDocsQueue.push(() => new Promise(resolve => { resolveOld = resolve; }));
  const oldRequest = harness.run('loadEntries()');

  harness.expose('__newUser', { uid: 'session-b', displayName: 'B' });
  harness.run('resetSession(); currentUser = __newUser; demoMode = false;');
  resolveOld(snapshot([makeEntry('stale-a', 'session-a')]));
  await oldRequest;

  assert.equal(harness.get('currentUser').uid, 'session-b');
  assert.deepEqual(Array.from(harness.get('allEntries')), []);
  assert.equal(harness.get('historyError'), '');
  assert.equal(harness.get('loadingHistory'), false);
});

test('paginação usa limite, cursor e deduplicação por ID', async () => {
  const harness = createHarness();
  const user = { uid: 'user-pages', displayName: 'Pages' };
  const firstPage = Array.from({ length: 100 }, (_, index) => makeEntry(`entry-${index}`, user.uid, {
    createdAt: new Date(Date.now() - (index + 1) * 86400000),
  }));
  const duplicate = { ...firstPage[99], headline: 'versão mais recente do duplicado' };
  const newEntry = makeEntry('entry-100', user.uid, { createdAt: new Date(Date.now() - 101 * 86400000) });
  harness.setSession(user, []);
  harness.store.getDocsQueue.push(snapshot(firstPage), snapshot([duplicate, newEntry]));

  await harness.run('loadEntries()');
  assert.equal(harness.get('allEntries').length, 100);
  assert.equal(harness.el('history-load-more').hidden, false);
  assert.equal(harness.store.queries[0].constraints.find(constraint => constraint.kind === 'limit').value, 100);
  assert.equal(harness.store.queries[0].constraints.some(constraint => constraint.kind === 'startAfter'), false);

  await harness.el('history-load-more').onclick();
  const entries = harness.get('allEntries');
  assert.equal(entries.length, 101);
  assert.equal(new Set(entries.map(entry => entry.id)).size, 101);
  assert.equal(entries.find(entry => entry.id === 'entry-99').headline, 'versão mais recente do duplicado');
  assert.equal(harness.el('history-load-more').hidden, true);
  const secondConstraints = harness.store.queries[1].constraints;
  assert.equal(secondConstraints.find(constraint => constraint.kind === 'limit').value, 100);
  const cursorConstraint = secondConstraints.find(constraint => constraint.kind === 'startAfter');
  assert.ok(cursorConstraint);
  assert.equal(cursorConstraint.cursor.id, 'entry-99');
});
