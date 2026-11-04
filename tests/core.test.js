import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, normalizeText, toDate, dayKey, dayNumber, dateFromDayNumber, streakMetrics, uniqueDays, weekRange, entriesInRange, periodMetrics, filterEntries, validateEntry, sanitizeEntry, gratitudeWords } from '../js/core.js';
const entry = (day, data = {}) => ({ createdAt: new Date(`${day}T12:00:00`), headline: 'Saúde e gratidão', lead: '', palavra: 'família', gratidoes: ['Minha família'], eixos: ['Família'], ...data });
const valid = { headline: 'Meu dia', lead: 'Um dia tranquilo', palavra: 'paz', gratidoes: ['Minha família'], eixos: ['Família'] };

test('escape neutraliza marcação HTML e atributos', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml("'&"), '&#39;&amp;');
});
test('normalização encontra palavras com acentos', () => assert.equal(normalizeText('  SAÚDE '), 'saude'));
test('timestamp ausente não vira hoje', () => { assert.equal(toDate(null), null); assert.equal(toDate({}), null); assert.equal(dayKey(undefined), ''); });
test('timestamp inválido e método com erro não entram em métricas', () => { assert.equal(toDate('invalido'), null); assert.equal(toDate({ toDate() { throw Error(); } }), null); });
test('aceita timestamp Firebase serializado e epoch zero', () => { assert.equal(toDate({ seconds: 0 }).getTime(), 0); assert.equal(toDate(0).getTime(), 0); });
test('chave diária usa calendário local e mês base um', () => assert.equal(dayKey(new Date(2026, 10, 4, 0, 10)), '2026-11-04'));
test('número de dia e reconstrução preservam data civil', () => { const d = new Date(2026, 10, 4); assert.equal(dayKey(dateFromDayNumber(dayNumber(d))), '2026-11-04'); });
test('sequência ignora duplicatas do mesmo dia', () => { const es = [entry('2026-11-04'), entry('2026-11-04'), entry('2026-11-03')]; assert.equal(streakMetrics(es, new Date(2026, 10, 4)).current, 2); assert.equal(uniqueDays(es).length, 2); });
test('sequência continua se ontem existe e hoje ainda não', () => assert.equal(streakMetrics([entry('2026-11-03'), entry('2026-11-02')], new Date(2026, 10, 4)).current, 2));
test('intervalo quebrado zera atual sem apagar recorde', () => { const m = streakMetrics([entry('2026-11-01'), entry('2026-10-31')], new Date(2026, 10, 4)); assert.equal(m.current, 0); assert.equal(m.record, 2); });
test('sequência atravessa mês e ano', () => assert.equal(streakMetrics([entry('2027-01-01'), entry('2026-12-31')], new Date(2027, 0, 1)).record, 2));
test('dias consecutivos mantêm sequência na mudança de horário de verão', () => {
  const original = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try { const es = [entry('2026-03-09'), entry('2026-03-08'), entry('2026-03-07')]; assert.equal(streakMetrics(es, new Date(2026, 2, 9)).current, 3); }
  finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
test('semana explícita domingo a sábado tem limite superior exclusivo', () => {
  const { start, end } = weekRange(new Date(2026, 10, 4)); assert.equal(dayKey(start), '2026-11-01'); assert.equal(dayKey(end), '2026-11-08');
  assert.equal(entriesInRange([entry('2026-10-31'), entry('2026-11-01'), entry('2026-11-08')], start, end).length, 1);
});
test('métricas distinguem registros de dias e gratidões', () => { const m = periodMetrics([entry('2026-11-04'), entry('2026-11-04')]); assert.deepEqual(m, { entries: 2, days: 1, gratitudes: 2, axes: 1 }); });
test('busca combina texto sem acento, eixo e período inclusivo', () => {
  const es = [entry('2026-11-04'), entry('2026-11-03'), entry('2026-10-31')];
  assert.equal(filterEntries(es, { term: 'saude', axis: 'Família', from: '2026-11-03', to: '2026-11-04' }).length, 2);
});
test('busca inclui palavra do dia, gratidão e área', () => { assert.equal(filterEntries([entry('2026-11-04')], { term: 'familia' }).length, 1); });
test('data inválida não satisfaz filtro temporal', () => assert.equal(filterEntries([entry('2026-11-04', { createdAt: null })], { from: '2026-01-01' }).length, 0));
test('validação é igual para criação e edição', () => { assert.deepEqual(validateEntry(valid).value, valid); assert.equal(validateEntry({ ...valid, gratidoes: [] }).field, 'gratidoes'); });
test('validação impõe todos os limites editoriais', () => {
  for (const [field, max] of [['headline', 120], ['lead', 500], ['palavra', 30]]) assert.equal(validateEntry({ ...valid, [field]: 'a'.repeat(max + 1) }).field, field);
  assert.equal(validateEntry({ ...valid, gratidoes: ['a'.repeat(201)] }).field, 'gratidoes');
  assert.equal(validateEntry({ ...valid, gratidoes: ['a', 'b', 'c', 'd'] }).field, 'gratidoes');
});
test('validação remove áreas desconhecidas e duplicadas', () => assert.deepEqual(validateEntry({ ...valid, eixos: ['Família', 'Família', '<script>'] }).value.eixos, ['Família']));
test('ID de documento é autoritativo, dados não podem sobrescrevê-lo', () => assert.equal(sanitizeEntry({ ...valid, id: 'falso', uid: 'u', createdAt: null }, 'real').id, 'real'));
test('sanitização evita arrays e strings de tipos inesperados', () => { const clean = sanitizeEntry({ headline: {}, gratidoes: 'abc', eixos: [12, 'Família'], createdAt: null }, 'x'); assert.equal(clean.headline, ''); assert.deepEqual(clean.gratidoes, []); assert.deepEqual(clean.eixos, ['Família']); });
test('palavras de gratidão normalizam Unicode e descartam palavras comuns', () => { const words = gratitudeWords([entry('2026-11-04', { gratidoes: ['Sou grato pela família! Família — saúde.'] })]); assert.equal(words[0][0], 'familia'); assert.equal(words[0][1], 2); assert.ok(!words.some(([w]) => w === 'grato')); });

test('registros futuros não alteram sequência nem recorde', () => {
  const entries = [entry('2026-11-06'), entry('2026-11-05'), entry('2026-11-04'), entry('2026-11-03')];
  const metrics = streakMetrics(entries, new Date(2026, 10, 4));
  assert.equal(metrics.current, 2);
  assert.equal(metrics.record, 2);
  assert.equal(metrics.sequences.length, 1);
});
