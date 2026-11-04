export const DAY_MS = 86400000;
export const ALLOWED_AXES = [
  'Saúde e Disposição', 'Desenvolvimento Intelectual', 'Equilíbrio Emocional',
  'Realização e Propósito', 'Recursos Financeiros', 'Contribuição Social',
  'Relacionamento Amoroso', 'Família', 'Vida Social',
  'Criatividade e Hobbies', 'Plenitude e Felicidade', 'Espiritualidade'
];

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

export function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

export function toDate(timestamp) {
  let value;
  try {
    if (timestamp instanceof Date) value = new Date(timestamp.getTime());
    else if (timestamp && typeof timestamp.toDate === 'function') value = timestamp.toDate();
    else if (timestamp && typeof timestamp.seconds === 'number') value = new Date(timestamp.seconds * 1000);
    else if (typeof timestamp === 'number' || typeof timestamp === 'string') value = new Date(timestamp);
  } catch { return null; }
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
}

export function dayNumber(value) {
  const d = toDate(value);
  return d ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS : null;
}

export function dayKey(value) {
  const d = toDate(value);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
}

export function uniqueDays(entries) {
  return [...new Set(entries.map(e => dayNumber(e.createdAt)).filter(n => n !== null))].sort((a, b) => b - a);
}

export function streakMetrics(entries, now = new Date()) {
  const today = dayNumber(now);
  const days = uniqueDays(entries).filter(day => day <= today);
  if (!days.length) return { current: 0, record: 0, sequences: [] };
  const groups = [];
  let count = 1;
  let end = days[0];
  for (let i = 1; i < days.length; i++) {
    if (days[i - 1] - days[i] === 1) count++;
    else { groups.push({ days: count, end }); count = 1; end = days[i]; }
  }
  groups.push({ days: count, end });
  const active = days[0] === today || days[0] === today - 1;
  return {
    current: active ? groups[0].days : 0,
    record: Math.max(...groups.map(group => group.days)),
    sequences: groups.sort((a, b) => b.days - a.days || b.end - a.end).slice(0, 5)
  };
}

export function dateFromDayNumber(n) {
  const utc = new Date(n * DAY_MS);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 12);
}

export function weekRange(now = new Date(), offset = 0) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + offset * 7);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start, end };
}

export function entriesInRange(entries, start, end) {
  return entries.filter(entry => {
    const date = toDate(entry.createdAt);
    return date && date >= start && date < end;
  });
}

export function periodMetrics(entries) {
  return {
    entries: entries.length,
    days: uniqueDays(entries).length,
    gratitudes: entries.reduce((total, entry) => total + (Array.isArray(entry.gratidoes) ? entry.gratidoes.length : 0), 0),
    axes: [...new Set(entries.flatMap(entry => Array.isArray(entry.eixos) ? entry.eixos : []))].length
  };
}

export function filterEntries(entries, { term = '', axis = '', from = '', to = '' } = {}) {
  const normalized = normalizeText(term);
  return entries.filter(entry => {
    const key = dayKey(entry.createdAt);
    if ((from || to) && !key) return false;
    if (from && key < from) return false;
    if (to && key > to) return false;
    if (axis && !(entry.eixos || []).includes(axis)) return false;
    const words = [entry.headline, entry.lead, entry.palavra, ...(entry.gratidoes || []), ...(entry.eixos || [])];
    return !normalized || words.some(word => normalizeText(word).includes(normalized));
  });
}

export function validateEntry(input) {
  const clean = {
    headline: String(input.headline ?? '').trim(),
    lead: String(input.lead ?? '').trim(),
    palavra: String(input.palavra ?? '').trim(),
    gratidoes: (Array.isArray(input.gratidoes) ? input.gratidoes : []).map(g => String(g).trim()).filter(Boolean),
    eixos: [...new Set((Array.isArray(input.eixos) ? input.eixos : []).filter(axis => ALLOWED_AXES.includes(axis)))]
  };
  if (!clean.headline) return { error: 'Escreva a manchete do dia.', field: 'headline' };
  if (clean.headline.length > 120) return { error: 'A manchete pode ter até 120 caracteres.', field: 'headline' };
  if (clean.lead.length > 500) return { error: 'O resumo pode ter até 500 caracteres.', field: 'lead' };
  if (!clean.gratidoes.length) return { error: 'Adicione pelo menos uma gratidão.', field: 'gratidoes' };
  if (clean.gratidoes.length > 3 || clean.gratidoes.some(g => g.length > 200)) return { error: 'Use até três gratidões de até 200 caracteres.', field: 'gratidoes' };
  if (clean.palavra.length > 30) return { error: 'A palavra do dia pode ter até 30 caracteres.', field: 'palavra' };
  return { value: clean };
}

export function sanitizeEntry(raw, id) {
  const value = validateEntry(raw).value;
  const strings = list => (Array.isArray(list) ? list : []).filter(item => typeof item === 'string');
  return {
    id, uid: typeof raw.uid === 'string' ? raw.uid : '',
    headline: typeof raw.headline === 'string' ? raw.headline : '',
    lead: typeof raw.lead === 'string' ? raw.lead : '',
    palavra: typeof raw.palavra === 'string' ? raw.palavra : '',
    gratidoes: strings(raw.gratidoes).slice(0, 3),
    eixos: value?.eixos || [...new Set(strings(raw.eixos).filter(axis => ALLOWED_AXES.includes(axis)))],
    createdAt: raw.createdAt
  };
}

const STOP_WORDS = new Set(['para', 'pela', 'pelo', 'pelas', 'pelos', 'como', 'essa', 'esse', 'esta', 'este', 'hoje', 'muito', 'mais', 'grato', 'grata', 'porque', 'todos', 'todas', 'minha', 'meus', 'minhas', 'seus', 'suas', 'sobre', 'mesmo', 'ainda', 'tambem', 'poder', 'cada', 'isso', 'isto', 'tenho', 'estou', 'voce', 'comigo']);
export function gratitudeWords(entries) {
  const counts = new Map();
  entries.flatMap(entry => entry.gratidoes || []).forEach(text => {
    const words = normalizeText(text).match(/[\p{L}]+/gu) || [];
    words.filter(word => word.length > 3 && !STOP_WORDS.has(word)).forEach(word => counts.set(word, (counts.get(word) || 0) + 1));
  });
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).slice(0, 12);
}
