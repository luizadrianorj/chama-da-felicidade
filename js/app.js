import { escapeHtml as esc, toDate, dayKey, dateFromDayNumber, streakMetrics, weekRange, entriesInRange, periodMetrics, filterEntries, validateEntry, sanitizeEntry, gratitudeWords, ALLOWED_AXES } from './core.js';
import { MONTHS_PT, MONTHS_SHORT, DAYS_PT, DAYS_FULL, FRASES, REFLEXIVAS, EIXOS_COLORS } from './catalog.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDYzFgouAfTEQykiXfnykSFYkffR8Uuf8Q',
  authDomain: 'chama-da-felicidade-f0a97.firebaseapp.com',
  projectId: 'chama-da-felicidade-f0a97',
  storageBucket: 'chama-da-felicidade-f0a97.firebasestorage.app',
  messagingSenderId: '583712540808',
  appId: '1:583712540808:web:0844c68a196fcf6e80773d'
};
const PAGE_SIZE = 100;
const $ = id => document.getElementById(id);
let auth, db, authApi, storeApi, provider;
let currentUser = null;
let allEntries = [];
let editingId = null;
let deletingId = null;
let demoMode = false;
let loadingHistory = false;
let historyError = '';
let hasMore = false;
let cursor = null;
let epoch = 0;
let mutationBusy = false;
let activeScreen = 'auth';
let modalReturnFocus = null;
let toastTimer;

function notice(message = '', action) {
  const banner = $('status-banner');
  banner.replaceChildren(); banner.hidden = !message;
  if (!message) return;
  const text = document.createElement('span'); text.textContent = message; banner.append(text);
  if (action) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label;
    button.addEventListener('click', action.run); banner.append(button);
  }
}
function resetSession(preserveNotice = false) {
  epoch++; currentUser = null; allEntries = []; cursor = null; hasMore = false;
  loadingHistory = false; historyError = ''; editingId = deletingId = null; modalReturnFocus = null;
  clearForm(); closeModal('edit-modal'); closeModal('confirm-modal');
  ['edit-headline', 'edit-lead', 'edit-palavra', 'edit-grat1', 'edit-grat2', 'edit-grat3', 'search-input', 'search-from', 'search-to'].forEach(id => { $(id).value = ''; $(id).removeAttribute('aria-invalid'); });
  document.querySelectorAll('.edit-eixo-chip').forEach(chip => { chip.classList.remove('active'); chip.setAttribute('aria-pressed', 'false'); });
  $('search-eixo').value = ''; $('month-select').replaceChildren();
  ['entries-list', 'search-results', 'month-entries', 'report-headlines', 'streak-history', 'roda-legend', 'word-cloud-words'].forEach(id => $(id).replaceChildren());
  $('roda-chart').getContext('2d')?.clearRect(0, 0, 780, 780);
  ['report-summary', 'month-summary', 'search-count', 'history-note'].forEach(id => { $(id).textContent = ''; });
  $('history-load-more').hidden = true; $('user-name-label').textContent = '';
  $('user-bar').style.display = 'none'; $('bottom-nav').style.display = 'none'; $('demo-notice').hidden = true;
  if (!preserveNotice) notice();
}
async function initializeFirebase() {
  const button = $('btn-google'); button.disabled = true;
  $('auth-loading').style.display = 'block'; $('auth-loading').textContent = 'Preparando conexão segura…';
  const timer = setTimeout(() => { if (!demoMode) notice('A conexão está demorando. Explore a demonstração ou recarregue.'); }, 12000);
  try {
    const [appApi, authModule, firestoreModule] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
    ]);
    authApi = authModule; storeApi = firestoreModule;
    const app = appApi.initializeApp(firebaseConfig);
    auth = authApi.getAuth(app); db = storeApi.getFirestore(app); provider = new authApi.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try { await authApi.setPersistence(auth, authApi.browserLocalPersistence); }
    catch { if (!demoMode) notice('O navegador não permite manter a sessão. Você poderá precisar entrar novamente.'); }
    try { await authApi.getRedirectResult(auth); }
    catch (error) { if (!demoMode) notice(authMessage(error)); }
    authApi.onAuthStateChanged(auth, async user => {
      if (demoMode) return;
      resetSession(true);
      if (!user) { goTo('auth'); return; }
      currentUser = user;
      $('user-name-label').textContent = user.displayName?.split(' ')[0] || 'você';
      $('user-bar').style.display = 'flex'; $('bottom-nav').style.display = 'flex';
      restoreDraft(); goTo('home'); await loadEntries();
    }, () => notice('Não foi possível verificar sua sessão. Recarregue para tentar novamente.'));
    button.disabled = false;
  } catch (error) {
    if (!demoMode) notice('Não foi possível conectar ao login. Seus dados não foram apagados. Verifique a internet e tente novamente.', { label: 'Recarregar e tentar', run: () => location.reload() });
    console.error('Falha ao inicializar Firebase:', error.code || error.name);
  } finally { clearTimeout(timer); $('auth-loading').style.display = 'none'; }
}
function authMessage(error) {
  const messages = {
    'auth/unauthorized-domain': 'Este endereço não está autorizado no Firebase. Use o app no endereço original ou explore a demonstração.',
    'auth/popup-blocked': 'O navegador bloqueou a janela de login. Tentaremos abrir na mesma aba.',
    'auth/popup-closed-by-user': 'Login cancelado. Você pode tentar novamente.',
    'auth/network-request-failed': 'Não foi possível conectar. Verifique sua internet.',
    'auth/cancelled-popup-request': 'Já existe uma tentativa de login em andamento.'
  };
  return messages[error.code] || 'Não foi possível entrar. Tente novamente.';
}
window.signInWithGoogle = async () => {
  if (!auth || $('btn-google').disabled) return;
  demoMode = false;
  const button = $('btn-google'); button.disabled = true;
  $('auth-loading').style.display = 'block'; $('auth-loading').textContent = 'Conectando ao Google…'; notice();
  try { await authApi.signInWithPopup(auth, provider); }
  catch (error) {
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment') {
      try { await authApi.signInWithRedirect(auth, provider); } catch (redirectError) { notice(authMessage(redirectError)); }
    } else notice(authMessage(error));
  } finally { button.disabled = false; $('auth-loading').style.display = 'none'; }
};
window.signOut = async () => {
  if (mutationBusy) { showToast('Aguarde a operação terminar antes de sair.'); return; }
  const uid = currentUser?.uid;
  try {
    if (!demoMode && auth) await authApi.signOut(auth);
    try { if (uid) sessionStorage.removeItem(draftKey(uid)); } catch { /* Optional storage. */ }
    demoMode = false; resetSession(); goTo('auth');
  } catch { showToast('Não foi possível sair. Tente novamente.'); }
};
window.startDemo = () => {
  resetSession(); demoMode = true; currentUser = { uid: 'demo-local', displayName: 'Visitante' };
  const stories = [
    ['Um encontro simples fez o dia valer a pena', 'Uma conversa tranquila com uma pessoa querida abriu espaço para uma tarde mais leve.', 'família', ['Minha família', 'O almoço preparado com carinho'], ['Família', 'Plenitude e Felicidade']],
    ['Uma caminhada e novas ideias', 'Desliguei as notificações e aproveitei o caminho para organizar meus pensamentos.', 'equilíbrio', ['A caminhada no parque', 'Minha saúde'], ['Saúde e Disposição', 'Equilíbrio Emocional']],
    ['Aprender algo novo trouxe energia', 'Terminei uma leitura e anotei uma ideia para colocar em prática.', 'descoberta', ['O tempo para ler', 'Uma ideia nova'], ['Desenvolvimento Intelectual', 'Criatividade e Hobbies']],
    ['Pequenas conquistas também merecem manchete', 'Concluí uma tarefa importante e reconheci meu esforço.', 'propósito', ['O apoio de um amigo', 'A oportunidade de aprender'], ['Realização e Propósito', 'Vida Social']],
    ['Uma pausa para agradecer', 'Procurei notar o que costuma passar despercebido. Foi bom desacelerar.', 'presença', ['Um café tranquilo', 'O silêncio da manhã'], ['Espiritualidade', 'Plenitude e Felicidade']]
  ];
  allEntries = stories.map((story, index) => {
    const date = new Date(); date.setDate(date.getDate() - index);
    return { id: `demo-${index}`, uid: currentUser.uid, headline: story[0], lead: story[1], palavra: story[2], gratidoes: story[3], eixos: story[4], createdAt: date };
  });
  $('user-name-label').textContent = 'Visitante'; $('user-bar').style.display = 'flex'; $('bottom-nav').style.display = 'flex';
  $('demo-notice').hidden = false; goTo('home'); updateMasthead();
};
window.goTo = screen => {
  if (screen !== 'auth' && !currentUser) screen = 'auth';
  const target = $('screen-' + screen); if (!target) return;
  activeScreen = screen;
  document.querySelectorAll('.screen').forEach(element => element.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(button => {
    const active = button.id === 'nav-' + screen; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  target.classList.add('active'); document.querySelector('.scroll-area').scrollTop = 0;
  if (screen === 'home') renderHome();
  if (screen === 'search') renderSearch();
  if (screen === 'report') renderReport();
  if (screen === 'month') { populateMonthSelect(); renderMonth(); }
};
function refreshCurrentScreen() {
  renderHome(); updateMasthead();
  if (activeScreen === 'search') renderSearch();
  if (activeScreen === 'report') renderReport();
  if (activeScreen === 'month') { populateMonthSelect(); renderMonth(); }
}
async function loadEntries(append = false) {
  if (!currentUser || demoMode || loadingHistory) return;
  const uid = currentUser.uid, requestEpoch = epoch;
  loadingHistory = true; historyError = ''; renderHistoryStatus();
  try {
    const constraints = [storeApi.where('uid', '==', uid), storeApi.orderBy('createdAt', 'desc')];
    if (append && cursor) constraints.push(storeApi.startAfter(cursor));
    constraints.push(storeApi.limit(PAGE_SIZE));
    const query = storeApi.query(storeApi.collection(db, 'chamadas'), ...constraints);
    const snapshot = await storeApi.getDocs(query);
    if (epoch !== requestEpoch || currentUser?.uid !== uid || demoMode) return;
    const incoming = snapshot.docs.map(document => sanitizeEntry(document.data(), document.id));
    const merged = append ? [...allEntries, ...incoming] : incoming;
    allEntries = [...new Map(merged.filter(entry => entry.uid === uid).map(entry => [entry.id, entry])).values()];
    cursor = snapshot.docs.at(-1) || null; hasMore = snapshot.docs.length === PAGE_SIZE;
  } catch (error) {
    if (epoch !== requestEpoch || currentUser?.uid !== uid) return;
    historyError = error.code === 'permission-denied' ? 'O Firebase não autorizou a leitura. Verifique as regras de acesso.'
      : error.code === 'failed-precondition' ? 'A consulta precisa de um índice no Firestore. Consulte as instruções de configuração.'
        : 'Não foi possível carregar seu histórico. Verifique a conexão e tente novamente.';
    // Preserve entries already loaded. Failure is not an empty diary.
  } finally {
    if (epoch === requestEpoch && currentUser?.uid === uid) { loadingHistory = false; refreshCurrentScreen(); }
  }
}
window.loadMoreEntries = () => loadEntries(true);
function renderHistoryStatus() {
  $('history-note').textContent = demoMode ? `${allEntries.length} registros fictícios para explorar.` : loadingHistory ? 'Carregando seu histórico…'
    : historyError || (hasMore ? `${allEntries.length} registros carregados. Há registros mais antigos. Indicadores e exportações são parciais.` : `${allEntries.length} registro(s) carregado(s).`);
  const button = $('history-load-more'); button.style.display = '';
  button.hidden = demoMode || (!hasMore && !historyError); button.disabled = loadingHistory;
  button.textContent = historyError ? 'Tentar novamente' : 'Carregar registros mais antigos';
  button.onclick = () => loadEntries(Boolean(cursor));
}
function publishedToday() { return allEntries.some(entry => dayKey(entry.createdAt) === dayKey(new Date())); }
function updateMasthead() {
  const now = new Date(); $('today-label').textContent = `${DAYS_PT[now.getDay()]}, ${now.getDate()} ${MONTHS_SHORT[now.getMonth()]}`;
  $('edition-num').textContent = `Ed. ${allEntries.length + (publishedToday() ? 0 : 1)}${hasMore ? '+' : ''}`;
}
function formattedDate(value) {
  const date = toDate(value);
  return date ? `${DAYS_FULL[date.getDay()]}, ${date.getDate()} de ${MONTHS_PT[date.getMonth()]} de ${date.getFullYear()}` : 'Data indisponível';
}
function entryCardHTML(entry) {
  const tags = entry.eixos.map(axis => `<span class="chip-tag">${esc(axis)}</span>`).join('');
  return `<article class="entry-card"><div class="entry-card-date">${esc(formattedDate(entry.createdAt))}</div><div class="entry-card-headline">“${esc(entry.headline)}”</div>
    ${entry.lead ? `<div class="entry-card-lead">${esc(entry.lead)}</div>` : ''}<div class="entry-card-tags">${entry.palavra ? `<span class="chip-tag">${esc(entry.palavra)}</span>` : ''}${tags}</div>
    <div class="entry-card-actions"><button type="button" class="btn-card-action share" data-action="share" data-id="${esc(entry.id)}">Compartilhar</button>
    <button type="button" class="btn-card-action" data-action="edit" data-id="${esc(entry.id)}">Editar</button><button type="button" class="btn-card-action del" data-action="delete" data-id="${esc(entry.id)}">Excluir</button></div></article>`;
}
function renderHome() {
  const now = new Date(), phrase = FRASES[now.getDate() % FRASES.length];
  $('frase-text').textContent = `“${phrase.text}”`; $('frase-autor').textContent = `— ${phrase.autor}`;
  $('reflexiva-q').textContent = REFLEXIVAS[now.getDate() % REFLEXIVAS.length];
  const metrics = streakMetrics(allEntries); $('streak-num').textContent = metrics.current;
  $('streak-sub').textContent = metrics.current ? `${metrics.current} dia(s). Um dia de cada vez.` : 'Sua próxima chama pode ser hoje.';
  $('streak-record').textContent = metrics.record ? `Recorde${hasMore ? ' no histórico carregado' : ''}: ${metrics.record} dias` : '';
  const published = publishedToday();
  $('btn-nova-chama').textContent = published ? 'Chama de hoje registrada — editar' : '+ Nova chama de hoje';
  $('btn-nova-chama').disabled = loadingHistory || Boolean(historyError);
  $('btn-nova-chama').onclick = () => published ? openEdit(allEntries.find(entry => dayKey(entry.createdAt) === dayKey(now)).id) : goTo('entry');
  $('entries-list').innerHTML = allEntries.length ? allEntries.slice(0, 5).map(entryCardHTML).join('')
    : historyError ? '<div class="empty-state"><p>Seu histórico está indisponível.</p><small>Isso não significa que seus registros foram apagados.</small></div>'
      : loadingHistory ? '<div class="empty-state"><p>Buscando suas chamas…</p></div>' : '<div class="empty-state"><p>Sua primeira manchete começa aqui.</p><small>Registre um momento pelo qual você é grato.</small></div>';
  renderHistoryStatus();
}
function readForm(edit = false) {
  return {
    headline: $(edit ? 'edit-headline' : 'inp-headline').value, lead: $(edit ? 'edit-lead' : 'inp-lead').value,
    palavra: $(edit ? 'edit-palavra' : 'inp-palavra').value,
    gratidoes: (edit ? ['edit-grat1', 'edit-grat2', 'edit-grat3'] : ['grat-1', 'grat-2', 'grat-3']).map(id => $(id).value),
    eixos: [...document.querySelectorAll(edit ? '.edit-eixo-chip.active' : '.eixo-chip.active')].map(chip => chip.dataset.eixo)
  };
}
function formError(result, edit = false) {
  showToast(result.error);
  const ids = edit ? { headline: 'edit-headline', lead: 'edit-lead', palavra: 'edit-palavra', gratidoes: 'edit-grat1' }
    : { headline: 'inp-headline', lead: 'inp-lead', palavra: 'inp-palavra', gratidoes: 'grat-1' };
  const field = $(ids[result.field]); field?.setAttribute('aria-invalid', 'true'); field?.focus();
}
function setBusy(button, busy, text) {
  mutationBusy = busy; button.disabled = busy; button.textContent = text;
  document.querySelectorAll('.btn-signout').forEach(element => { element.disabled = busy; });
}
function requireConnection() {
  if (demoMode || navigator.onLine !== false) return true;
  showToast('Você está sem internet. Reconecte para salvar alterações no diário.');
  return false;
}
window.saveEntry = async () => {
  if (!currentUser || mutationBusy) return;
  if (!requireConnection()) return;
  if (loadingHistory || historyError) { showToast('Carregue seu histórico antes de registrar um novo dia.'); return; }
  if (publishedToday()) { showToast('Você já registrou hoje. Edite a chama existente.'); openEdit(allEntries.find(entry => dayKey(entry.createdAt) === dayKey(new Date())).id); return; }
  const result = validateEntry(readForm()); if (result.error) { formError(result); return; }
  const uid = currentUser.uid, operationEpoch = epoch, button = $('save-btn'); setBusy(button, true, 'Salvando…');
  try {
    const entry = { ...result.value, uid, createdAt: demoMode ? new Date() : storeApi.Timestamp.now() };
    const reference = demoMode ? { id: `demo-${Date.now()}` } : await storeApi.addDoc(storeApi.collection(db, 'chamadas'), entry);
    if (epoch !== operationEpoch || currentUser?.uid !== uid) return;
    allEntries.unshift({ ...entry, id: reference.id }); clearForm(); refreshCurrentScreen(); goTo('home');
    showToast(demoMode ? 'Chama fictícia salva apenas nesta demonstração.' : 'Sua chama foi registrada.');
  } catch { showToast('Não foi possível salvar. Seu rascunho foi mantido.'); persistDraft(); }
  finally { setBusy(button, false, 'Registrar chama'); }
};
function clearForm() {
  ['inp-headline', 'inp-lead', 'grat-1', 'grat-2', 'grat-3', 'inp-palavra'].forEach(id => { $(id).value = ''; $(id).removeAttribute('aria-invalid'); });
  document.querySelectorAll('.eixo-chip').forEach(chip => { chip.classList.remove('active'); chip.setAttribute('aria-pressed', 'false'); });
  $('headline-count').textContent = '0'; $('lead-count').textContent = '0'; if ($('draft-status')) $('draft-status').textContent = '';
  try { if (currentUser && !demoMode) sessionStorage.removeItem(draftKey(currentUser.uid)); } catch { /* Optional storage. */ }
}
const draftKey = uid => `chama-draft:${location.pathname}:${uid}`;
function persistDraft() {
  if (!currentUser || demoMode) return;
  try {
    sessionStorage.setItem(draftKey(currentUser.uid), JSON.stringify(readForm()));
    $('draft-status').textContent = 'Rascunho salvo nesta aba para recarregamento. Será removido ao sair.';
  } catch { $('draft-status').textContent = 'Não foi possível guardar o rascunho. Mantenha a página aberta.'; }
}
function restoreDraft() {
  try {
    const raw = sessionStorage.getItem(draftKey(currentUser.uid)); if (!raw) return;
    const draft = JSON.parse(raw);
    for (const [field, id] of Object.entries({ headline: 'inp-headline', lead: 'inp-lead', palavra: 'inp-palavra' })) $(id).value = typeof draft[field] === 'string' ? draft[field] : '';
    ['grat-1', 'grat-2', 'grat-3'].forEach((id, index) => { $(id).value = typeof draft.gratidoes?.[index] === 'string' ? draft.gratidoes[index] : ''; });
    document.querySelectorAll('.eixo-chip').forEach(chip => {
      const selected = Array.isArray(draft.eixos) && draft.eixos.includes(chip.dataset.eixo);
      chip.classList.toggle('active', selected); chip.setAttribute('aria-pressed', String(selected));
    });
    updateCounters(); $('draft-status').textContent = 'Seu rascunho foi recuperado nesta aba.';
  } catch { /* Invalid drafts are ignored, never sent to the server. */ }
}
function openModal(id, focusId) { modalReturnFocus = document.activeElement; $(id).classList.remove('hidden'); $('app').inert = true; $(focusId)?.focus(); }
function closeModal(id) { $(id).classList.add('hidden'); $('app').inert = false; modalReturnFocus?.focus(); }
window.openEdit = id => {
  if (mutationBusy || !currentUser) return;
  const entry = allEntries.find(item => item.id === id && item.uid === currentUser.uid); if (!entry) return;
  editingId = id; $('edit-headline').value = entry.headline; $('edit-lead').value = entry.lead; $('edit-palavra').value = entry.palavra;
  ['edit-grat1', 'edit-grat2', 'edit-grat3'].forEach((field, index) => { $(field).value = entry.gratidoes[index] || ''; });
  document.querySelectorAll('.edit-eixo-chip').forEach(chip => { const active = entry.eixos.includes(chip.dataset.eixo); chip.classList.toggle('active', active); chip.setAttribute('aria-pressed', String(active)); });
  openModal('edit-modal', 'edit-headline');
};
window.closeEdit = () => { if (mutationBusy) return; closeModal('edit-modal'); editingId = null; };
window.saveEdit = async () => {
  if (!editingId || !currentUser || mutationBusy) return;
  if (!requireConnection()) return;
  const id = editingId, entry = allEntries.find(item => item.id === id && item.uid === currentUser.uid); if (!entry) return;
  const result = validateEntry(readForm(true)); if (result.error) { formError(result, true); return; }
  const operationEpoch = epoch, button = $('edit-save-btn'); setBusy(button, true, 'Salvando…');
  try {
    if (!demoMode) await storeApi.updateDoc(storeApi.doc(db, 'chamadas', id), result.value);
    if (epoch !== operationEpoch) return;
    Object.assign(entry, result.value); editingId = null; closeModal('edit-modal'); refreshCurrentScreen();
    showToast(demoMode ? 'Registro fictício atualizado.' : 'Chama atualizada.');
  } catch { showToast('Não foi possível editar. O formulário foi mantido.'); }
  finally { setBusy(button, false, 'Salvar'); }
};
window.askDelete = id => {
  if (mutationBusy || !currentUser || !allEntries.some(entry => entry.id === id && entry.uid === currentUser.uid)) return;
  deletingId = id; openModal('confirm-modal', 'delete-confirm-btn');
};
window.closeConfirm = () => { if (mutationBusy) return; closeModal('confirm-modal'); deletingId = null; };
window.confirmDelete = async () => {
  if (!deletingId || !currentUser || mutationBusy) return;
  if (!requireConnection()) return;
  const id = deletingId; if (!allEntries.some(entry => entry.id === id && entry.uid === currentUser.uid)) return;
  const operationEpoch = epoch, button = $('delete-confirm-btn'); setBusy(button, true, 'Excluindo…');
  try {
    if (!demoMode) await storeApi.deleteDoc(storeApi.doc(db, 'chamadas', id));
    if (epoch !== operationEpoch) return;
    allEntries = allEntries.filter(entry => entry.id !== id); deletingId = null; closeModal('confirm-modal'); refreshCurrentScreen();
    showToast(demoMode ? 'Registro fictício removido.' : 'Chama excluída.');
  } catch { showToast('Não foi possível excluir. Seu registro foi mantido.'); }
  finally { setBusy(button, false, 'Excluir'); }
};
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function shareText(text, title) {
  try {
    if (navigator.share) { await navigator.share({ title, text }); return; }
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); showToast('Texto copiado.'); return; }
    download(text, 'chama-compartilhar.txt', 'text/plain;charset=utf-8');
  } catch (error) {
    if (error.name !== 'AbortError') { download(text, 'chama-compartilhar.txt', 'text/plain;charset=utf-8'); showToast('Compartilhamento indisponível. O texto foi baixado.'); }
  }
}
window.shareEntry = id => {
  const entry = allEntries.find(item => item.id === id); if (!entry) return;
  return shareText(`Chama da Felicidade\n${formattedDate(entry.createdAt)}\n\n“${entry.headline}”\n\n${entry.lead || ''}`, 'Chama da Felicidade');
};
window.renderSearch = () => {
  const filters = { term: $('search-input').value, axis: $('search-eixo').value, from: $('search-from').value, to: $('search-to').value };
  if (filters.from && filters.to && filters.from > filters.to) { $('search-count').textContent = 'A data inicial deve ser anterior ou igual à final.'; $('search-results').replaceChildren(); return; }
  const results = filterEntries(allEntries, filters);
  $('search-count').textContent = `${results.length} resultado(s)${hasMore || historyError || loadingHistory ? ' no histórico carregado. Confira o estado na aba Hoje.' : '.'}`;
  $('search-results').innerHTML = results.length ? results.map(entryCardHTML).join('') : '<div class="empty-state"><p>Nenhuma chama encontrada.</p><small>Tente outro texto ou período.</small></div>';
};
function metricsText(entries) {
  const now = new Date();
  const metrics = periodMetrics(entries.filter(entry => { const date = toDate(entry.createdAt); return date && date <= now; }));
  return `${metrics.days} dia(s) registrado(s) · ${metrics.gratitudes} gratidão(ões) · ${metrics.axes} área(s) citada(s)${hasMore || historyError || loadingHistory ? ' · Histórico parcial ou indisponível' : ''}`;
}
function renderReport() {
  const { start, end } = weekRange(), now = new Date();
  const weekEntries = entriesInRange(allEntries, start, end).filter(entry => toDate(entry.createdAt) <= now);
  $('report-period').textContent = `${start.getDate()} ${MONTHS_SHORT[start.getMonth()]} – ${now.getDate()} ${MONTHS_SHORT[now.getMonth()]} · domingo a sábado`;
  $('report-summary').textContent = metricsText(weekEntries);
  $('report-headlines').innerHTML = weekEntries.length ? weekEntries.slice(0, 3).map(entry => `<div class="headline-item"><span class="headline-day">${DAYS_PT[toDate(entry.createdAt).getDay()]}</span><span class="headline-text">“${esc(entry.headline)}”</span></div>`).join('') : '<div class="empty-state"><p>Sua semana ainda está começando.</p></div>';
  renderRodaChart(weekEntries);
  const metrics = streakMetrics(allEntries);
  $('streak-history').innerHTML = metrics.sequences.length ? metrics.sequences.map((sequence, index) => `<div class="streak-hist-item"><div class="streak-hist-num">${sequence.days}</div><div class="streak-hist-info"><div class="streak-hist-label">${sequence.days} dia(s) seguidos</div><div class="streak-hist-label">até ${esc(formattedDate(dateFromDayNumber(sequence.end)))}</div></div>${index === 0 ? '<span class="streak-hist-badge">RECORDE</span>' : ''}</div>`).join('') : '<p>Sem sequências ainda.</p>';
  const words = gratitudeWords(weekEntries); $('word-cloud-block').style.display = words.length ? 'block' : 'none';
  $('word-cloud-words').innerHTML = words.map(([word, count]) => `<span class="word-cloud-word" style="font-size:${Math.round(15 + count / words[0][1] * 14)}px">${esc(word)}</span>`).join('');
}
function renderRodaChart(entries) {
  const counts = Object.fromEntries(ALLOWED_AXES.map(axis => [axis, 0]));
  entries.forEach(entry => [...new Set(entry.eixos)].forEach(axis => { if (axis in counts) counts[axis]++; }));
  const canvas = $('roda-chart'), context = canvas.getContext('2d'); if (!context) return;
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const grid = dark ? 'rgba(240,235,224,0.18)' : 'rgba(15,14,12,0.15)', color = dark ? '#e09030' : '#b8720a';
  const ratio = Math.min(window.devicePixelRatio || 1, 3); canvas.width = canvas.height = 260 * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, 260, 260);
  const radius = 110, center = 130, max = Math.max(entries.length, 1);
  const point = (index, fraction) => { const angle = index / ALLOWED_AXES.length * Math.PI * 2 - Math.PI / 2; return [center + Math.cos(angle) * radius * fraction, center + Math.sin(angle) * radius * fraction]; };
  for (let ring = 1; ring <= 5; ring++) { context.beginPath(); context.arc(center, center, radius * ring / 5, 0, Math.PI * 2); context.strokeStyle = grid; context.lineWidth = 0.5; context.stroke(); }
  ALLOWED_AXES.forEach((_, index) => { context.beginPath(); context.moveTo(center, center); context.lineTo(...point(index, 1)); context.stroke(); });
  context.beginPath(); ALLOWED_AXES.forEach((axis, index) => { const [x, y] = point(index, counts[axis] / max); if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); });
  context.closePath(); context.fillStyle = dark ? 'rgba(224,144,48,0.2)' : 'rgba(184,114,10,0.2)'; context.fill(); context.strokeStyle = color; context.lineWidth = 2; context.stroke();
  canvas.setAttribute('aria-label', 'Frequência de áreas citadas nesta semana. Valores disponíveis na lista abaixo.');
  $('roda-legend').innerHTML = ALLOWED_AXES.map(axis => `<div class="chart-legend-item"><div class="chart-legend-bar" style="width:${Math.round(counts[axis] / max * 90)}px;background:${EIXOS_COLORS[axis]}"></div><span class="chart-legend-label">${esc(axis)}</span><span class="chart-legend-count">${counts[axis]}/${entries.length}</span></div>`).join('');
}
function populateMonthSelect() {
  const selected = $('month-select').value, months = new Set([dayKey(new Date()).slice(0, 7)]);
  allEntries.forEach(entry => { const key = dayKey(entry.createdAt); if (key) months.add(key.slice(0, 7)); });
  $('month-select').innerHTML = [...months].sort().reverse().map(key => { const [year, month] = key.split('-').map(Number); return `<option value="${key}">${MONTHS_PT[month - 1]} de ${year}</option>`; }).join('');
  if (months.has(selected)) $('month-select').value = selected;
}
function monthEntries() { return allEntries.filter(entry => dayKey(entry.createdAt).slice(0, 7) === $('month-select').value); }
window.renderMonth = () => {
  const entries = monthEntries(); $('month-summary').textContent = metricsText(entries);
  $('month-entries').innerHTML = entries.length ? entries.map(entry => `<article class="month-entry"><div class="month-entry-date">${esc(formattedDate(entry.createdAt))}</div><div class="month-entry-headline">“${esc(entry.headline)}”</div>${entry.lead ? `<div class="month-entry-lead">${esc(entry.lead)}</div>` : ''}<div class="month-entry-grat">${entry.gratidoes.map((gratitude, index) => `<span>${index + 1}. ${esc(gratitude)}</span>`).join('')}</div><div class="month-entry-tags">${[entry.palavra, ...entry.eixos].filter(Boolean).map(tag => `<span class="chip-tag">${esc(tag)}</span>`).join('')}</div></article>`).join('') : '<div class="empty-state"><p>Nenhuma chama neste mês.</p></div>';
  $('export-btn').style.display = entries.length ? 'block' : 'none';
};
window.exportMonth = () => {
  const entries = monthEntries(); if (!entries.length) return;
  const text = `CHAMA DA FELICIDADE\nMês: ${$('month-select').value}\n${metricsText(entries)}\n${hasMore ? 'Atenção: exportação parcial. Carregue todos os registros na aba Hoje.\n' : ''}\n` + entries.map(entry => `${formattedDate(entry.createdAt)}\n${entry.headline}\n${entry.lead}\nPalavra: ${entry.palavra}\nGratidão:\n${entry.gratidoes.join('\n')}\nÁreas: ${entry.eixos.join(', ')}\n`).join('\n────────────────\n\n');
  return shareText(text, 'Chama da Felicidade — relatório mensal');
};
window.exportBackup = () => {
  if (!currentUser) return;
  const backup = { app: 'Chama da Felicidade', version: 1, exportedAt: new Date().toISOString(), complete: !hasMore && !historyError && !loadingHistory, demo: demoMode, entries: allEntries.map(entry => ({ ...entry, createdAt: toDate(entry.createdAt)?.toISOString() || null })) };
  download(JSON.stringify(backup, null, 2), `chama-backup-${dayKey(new Date())}${backup.complete ? '' : '-parcial'}.json`, 'application/json');
  showToast(backup.complete ? 'Backup baixado. Guarde-o em um local privado.' : 'Backup parcial. Carregue o restante do histórico para completar.');
};
window.showToast = message => { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('show'); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4200); };
function updateCounters() { $('headline-count').textContent = $('inp-headline').value.length; $('lead-count').textContent = $('inp-lead').value.length; }

document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]'); if (!action) return;
  const handlers = { share: shareEntry, edit: openEdit, delete: askDelete }; handlers[action.dataset.action]?.(action.dataset.id);
});
document.querySelectorAll('.eixo-chip, .edit-eixo-chip').forEach(chip => chip.addEventListener('click', () => {
  const active = !chip.classList.contains('active'); chip.classList.toggle('active', active); chip.setAttribute('aria-pressed', String(active));
  if (chip.classList.contains('eixo-chip')) persistDraft();
}));
['inp-headline', 'inp-lead', 'grat-1', 'grat-2', 'grat-3', 'inp-palavra'].forEach(id => $(id).addEventListener('input', () => { $(id).removeAttribute('aria-invalid'); updateCounters(); persistDraft(); }));
document.addEventListener('keydown', event => {
  const modal = ['edit-modal', 'confirm-modal'].map($).find(element => !element.classList.contains('hidden')); if (!modal) return;
  if (event.key === 'Escape') { if (modal.id === 'edit-modal') closeEdit(); else closeConfirm(); }
  if (event.key === 'Tab') {
    const controls = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
window.addEventListener('pagehide', persistDraft);
window.addEventListener('offline', () => notice('Você está sem internet. O rascunho desta aba continua disponível; salvar no diário exige conexão.'));
window.addEventListener('online', () => { notice(); if (historyError && !demoMode) loadEntries(Boolean(cursor)); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (activeScreen === 'report') renderReport(); });
async function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }); let requestedUpdate = false;
    const showUpdate = () => notice('Uma nova versão está disponível. Seu rascunho será preservado nesta aba.', { label: 'Atualizar app', run: () => {
      if (mutationBusy) { showToast('Aguarde a operação terminar antes de atualizar.'); return; }
      persistDraft(); requestedUpdate = true; registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    } });
    if (registration.waiting) showUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing; worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(); });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (requestedUpdate) location.reload(); });
    registration.update().catch(() => {});
  } catch { /* PWA is optional: failed registration never blocks the diary. */ }
}
$('loading').style.display = 'none'; $('app').style.display = 'flex'; goTo('auth'); updateMasthead(); initializeFirebase(); registerWorker();
