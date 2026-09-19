const { fold } = require('./normalizer');

function unique(list) { return [...new Set(list)]; }
function periodOf(record) { return String(record.periodo ?? record.ano); }
function periodBounds(label) {
  const parts = String(label).split('/').map((part) => Number(part.trim()));
  return { inicio: parts[0], fim: parts[1] || parts[0] };
}
function getPeriods(records) {
  const labels = unique(records.map(periodOf));
  return labels.sort((a, b) => { const left = periodBounds(a); const right = periodBounds(b); return left.inicio - right.inicio || left.fim - right.fim || a.localeCompare(b); });
}
const getYears = getPeriods;
function getTypes(records) { return unique(records.map((record) => record.tipo)); }

function companyMap(records) {
  const map = new Map();
  for (const record of records) {
    if (!map.has(record.empresaKey)) map.set(record.empresaKey, { empresa: record.empresa, periods: new Set(), types: new Set(), records: [] });
    const item = map.get(record.empresaKey);
    item.periods.add(periodOf(record)); item.types.add(record.tipo); item.records.push(record);
  }
  return map;
}

function consecutiveYears(years) {
  const sorted = [...years].sort((a, b) => a - b);
  let best = 0; let current = 0; let previous = null;
  for (const year of sorted) { current = previous === year - 1 ? current + 1 : 1; best = Math.max(best, current); previous = year; }
  return best;
}

function consecutivePeriods(periods, order) {
  const positions = [...periods].map((period) => order.indexOf(period)).filter((position) => position >= 0).sort((a, b) => a - b);
  let best = 0; let current = 0; let previous = null;
  for (const position of positions) { current = previous === position - 1 ? current + 1 : 1; best = Math.max(best, current); previous = position; }
  return best;
}

function yearSet(records) {
  const map = new Map();
  for (const record of records) { const period = periodOf(record); if (!map.has(period)) map.set(period, new Set()); map.get(period).add(record.empresaKey); }
  return map;
}

function parseTypes(types) {
  if (!types) return [];
  return (Array.isArray(types) ? types : String(types).split(',')).map((item) => { try { return decodeURIComponent(item); } catch { return item; } }).filter(Boolean);
}

function filterRecords(records, filters = {}) {
  const availablePeriods = getPeriods(records);
  const from = String(filters.fromYear || availablePeriods[0]);
  const to = String(filters.toYear || availablePeriods.at(-1));
  const fromPosition = Math.max(0, availablePeriods.indexOf(from));
  const toPosition = availablePeriods.indexOf(to) >= 0 ? availablePeriods.indexOf(to) : availablePeriods.length - 1;
  const selectedPeriod = filters.year ? String(filters.year) : '';
  const types = parseTypes(filters.types).map(fold);
  const company = filters.company ? fold(filters.company) : '';
  const search = fold(filters.search);
  const matchesContext = (record) => {
    const position = availablePeriods.indexOf(periodOf(record));
    return position >= fromPosition && position <= toPosition && (!selectedPeriod || periodOf(record) === selectedPeriod) && (!types.length || types.includes(record.tipoKey)) && (!company || record.empresaKey === company) && (!search || record.empresaKey.includes(search));
  };
  const companyCounts = new Map();
  const companyPeriods = new Map();
  for (const record of records) {
    if (matchesContext(record)) {
      companyCounts.set(record.empresaKey, (companyCounts.get(record.empresaKey) || 0) + 1);
      if (!companyPeriods.has(record.empresaKey)) companyPeriods.set(record.empresaKey, new Set());
      companyPeriods.get(record.empresaKey).add(periodOf(record));
    }
  }
  const min = Math.max(0, Number(filters.minParticipations) || 0);
  const recurrence = filters.recurrence || 'all';
  return records.filter((record) => {
    const inContext = matchesContext(record) && companyCounts.has(record.empresaKey);
    const enough = (companyCounts.get(record.empresaKey) || 0) >= min;
    const recurring = (companyPeriods.get(record.empresaKey)?.size || 0) > 1;
    return inContext && enough && (recurrence === 'all' || (recurrence === 'recurring' ? recurring : !recurring));
  });
}

function pct(value, total) { return total ? Math.round((value / total) * 1000) / 10 : 0; }

function formatCompany(item, periodOrder) {
  const periods = [...item.periods].sort((a, b) => periodOrder.indexOf(a) - periodOrder.indexOf(b));
  const anos = periods.map((period) => /^\d{4}$/.test(period) ? Number(period) : period);
  return { empresa: item.empresa, empresaKey: item.records[0]?.empresaKey, participacoes: item.records.length, anosDistintos: periods.length, primeira: periods[0] ?? null, ultima: periods.at(-1) ?? null, sequencia: consecutivePeriods(periods, periodOrder), interrupcoes: Math.max(0, periods.length - consecutivePeriods(periods, periodOrder)), anos, periodos: periods, tipos: [...item.types].sort() };
}

function compare(records, periodA, periodB) {
  const byPeriod = yearSet(records);
  const a = byPeriod.get(String(periodA)) || new Set(); const b = byPeriod.get(String(periodB)) || new Set();
  const names = new Map(records.map((record) => [record.empresaKey, record.empresa]));
  const both = [...a].filter((key) => b.has(key)); const entered = [...b].filter((key) => !a.has(key)); const left = [...a].filter((key) => !b.has(key));
  const sortedNames = (keys) => [...keys].map((key) => names.get(key)).sort((x, y) => x.localeCompare(y, 'pt-BR'));
  return { yearA: String(periodA), yearB: String(periodB), a: sortedNames(a), b: sortedNames(b), both: sortedNames(both), entered: sortedNames(entered), left: sortedNames(left), retention: pct(both.length, a.size) };
}

function buildInsights(data) {
  const insights = [];
  const bestYear = [...data.annual].sort((a, b) => b.total - a.total || String(a.year).localeCompare(String(b.year)))[0];
  if (bestYear) insights.push(`${bestYear.year} foi o período com maior número de participações (${bestYear.total}).`);
  const segment = [...data.segments].sort((a, b) => b.total - a.total)[0];
  if (segment && data.kpis.totalParticipacoes) insights.push(`${segment.tipo} representa ${segment.percentual.toLocaleString('pt-BR')}% dos registros selecionados.`);
  const five = data.companies.filter((item) => item.anosDistintos >= 5).length;
  insights.push(`${five} ${five === 1 ? 'empresa participou' : 'empresas participaram'} por pelo menos 5 períodos no recorte.`);
  const top = data.top[0];
  if (top) insights.push(`${top.empresa} possui a maior recorrência no período, com ${top.anosDistintos} períodos.`);
  const bestIndex = data.annual.findIndex((item) => item.year === bestYear?.year);
  const growth = bestIndex > 0 ? data.annual[bestIndex - 1] : null;
  if (growth && bestYear) { const delta = bestYear.total - growth.total; insights.push(`Entre ${growth.year} e ${bestYear.year} houve ${delta >= 0 ? 'crescimento' : 'redução'} de ${Math.abs(pct(delta, growth.total)).toLocaleString('pt-BR')}%.`); }
  return insights;
}

function calculateDashboard(allRecords, filters = {}) {
  const availablePeriods = getPeriods(allRecords);
  const availableTypes = getTypes(allRecords);
  const records = filterRecords(allRecords, filters);
  const rankingRecords = filterRecords(allRecords, { ...filters, company: '' });
  const fullMap = companyMap(allRecords); const map = companyMap(records); const periods = getPeriods(records);
  const rankingMap = companyMap(rankingRecords);
  const annual = periods.map((period, index) => { const periodRecords = records.filter((record) => periodOf(record) === period); const total = periodRecords.length; const previous = index ? records.filter((record) => periodOf(record) === periods[index - 1]).length : null; return { year: period, period, total, companies: new Set(periodRecords.map((record) => record.empresaKey)).size, variation: previous === null ? null : total - previous, variationPct: previous ? Math.round(((total - previous) / previous) * 1000) / 10 : null }; });
  const typeAnnual = periods.map((period) => { const periodRecords = records.filter((record) => periodOf(record) === period); return { year: period, period, total: periodRecords.length, values: availableTypes.map((tipo) => { const total = periodRecords.filter((record) => record.tipo === tipo).length; return { tipo, total, percentual: pct(total, periodRecords.length) }; }) }; });
  const segments = availableTypes.map((tipo) => { const total = records.filter((record) => record.tipo === tipo).length; return { tipo, total, percentual: pct(total, records.length) }; }).filter((item) => item.total);
  const companies = [...map.values()].map((item) => formatCompany(item, availablePeriods)).sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR'));
  const rankingOrdered = [...rankingMap.values()].map((item) => formatCompany(item, availablePeriods)).sort((a, b) => b.participacoes - a.participacoes || b.anosDistintos - a.anosDistintos || a.empresa.localeCompare(b.empresa, 'pt-BR'));
  const awardGroupSizes = new Map(); rankingOrdered.forEach((item) => awardGroupSizes.set(item.participacoes, (awardGroupSizes.get(item.participacoes) || 0) + 1));
  let previousAwards = null; let previousPosition = 0;
  const rankingCompanies = rankingOrdered.map((item, index) => { const position = item.participacoes === previousAwards ? previousPosition : index + 1; previousAwards = item.participacoes; previousPosition = position; return { ...item, position, empatado: (awardGroupSizes.get(item.participacoes) || 0) > 1 }; });
  const ranking = rankingCompanies.filter((item) => item.position <= 10);
  const highAwardCompanies = rankingCompanies.filter((item) => item.participacoes >= 10);
  const selectedRankingIndex = filters.company ? rankingCompanies.findIndex((item) => item.empresaKey === fold(filters.company)) : -1;
  const selectedRanking = selectedRankingIndex >= 0 ? rankingCompanies[selectedRankingIndex] : null;
  const top = [...companies].sort((a, b) => b.anosDistintos - a.anosDistintos || b.participacoes - a.participacoes || a.empresa.localeCompare(b.empresa, 'pt-BR'));
  const historicalFirst = new Map([...fullMap].map(([key, item]) => [key, [...item.periods].sort((a, b) => availablePeriods.indexOf(a) - availablePeriods.indexOf(b))[0]]));
  const annualMovement = periods.map((period) => { const names = new Set(records.filter((record) => periodOf(record) === period).map((record) => record.empresaKey)); const novos = [...names].filter((key) => historicalFirst.get(key) === period).length; const recorrentes = names.size - novos; return { year: period, period, novos, recorrentes, total: names.size, percentualRecorrencia: pct(recorrentes, names.size) }; });
  const sets = yearSet(records);
  const retention = periods.map((from) => { const baseIndex = availablePeriods.indexOf(from); return { from, base: sets.get(from)?.size || 0, horizons: [1, 2, 3].map((offset) => { const target = availablePeriods[baseIndex + offset]; const retained = target && sets.has(target) ? [...(sets.get(from) || [])].filter((key) => sets.get(target)?.has(key)).length : null; return { offset, target: target || null, retained, percentual: retained === null ? null : pct(retained, sets.get(from)?.size || 0) }; }), later: [...(sets.get(from) || [])].filter((key) => availablePeriods.some((period) => availablePeriods.indexOf(period) > baseIndex && sets.get(period)?.has(key))).length }; });
  const selectedProfile = filters.selectedCompany ? fullMap.get(fold(filters.selectedCompany)) : null;
  const profile = selectedProfile ? (() => { const periodos = [...selectedProfile.periods].sort((a, b) => availablePeriods.indexOf(a) - availablePeriods.indexOf(b)); return { empresa: selectedProfile.empresa, tipos: [...selectedProfile.types].sort(), primeira: periodos[0], ultima: periodos.at(-1), anosDistintos: periodos.length, sequencia: consecutivePeriods(periodos, availablePeriods), anos: periodos, periodos }; })() : null;
  const activePeriods = filters.year ? [String(filters.year)] : availablePeriods.filter((period, index) => index >= Math.max(0, availablePeriods.indexOf(String(filters.fromYear || availablePeriods[0]))) && index <= (availablePeriods.indexOf(String(filters.toYear || availablePeriods.at(-1))) >= 0 ? availablePeriods.indexOf(String(filters.toYear || availablePeriods.at(-1))) : availablePeriods.length - 1));
  const recurringCompanies = companies.filter((item) => item.anosDistintos > 1).length;
  const kpis = { totalParticipacoes: records.length, empresasUnicas: map.size, tiposEmpresas: new Set(records.map((record) => record.tipo)).size, mediaEmpresasPorAno: annual.length ? Math.round((annual.reduce((sum, item) => sum + item.companies, 0) / annual.length) * 10) / 10 : 0, empresasMaisDe10Premios: highAwardCompanies.length, empresasRecorrentes: recurringCompanies, empresasNovas: companies.filter((item) => activePeriods.includes(historicalFirst.get(item.empresaKey))).length, maiorParticipacoes: Math.max(0, ...companies.map((item) => item.anosDistintos)), taxaRecorrencia: pct(recurringCompanies, companies.length) };
  const result = { filters, meta: { years: availablePeriods, periods: availablePeriods, types: availableTypes, totalValidRecords: allRecords.length, duplicateRowsRemoved: 0 }, kpis, annual, typeAnnual, segments, top, companies, ranking, rankingTotal: rankingCompanies.length, highAwardCompanies, selectedRanking, annualMovement, retention, profile, insights: [] };
  result.insights = buildInsights(result);
  return result;
}

module.exports = { getYears, getPeriods, getTypes, consecutiveYears, filterRecords, calculateDashboard, compare, companyMap };
