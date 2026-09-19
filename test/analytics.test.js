const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCsv } = require('../src/normalizer');
const { calculateDashboard, consecutiveYears, compare, filterRecords } = require('../src/analytics');

function sample() {
  return normalizeCsv(`EMPRESA,ANO,TIPO\n Alpha Ltda ,2010,Meios de Hospedagem\nAlpha Ltda,2011,Meios de Hospedagem\nAlpha Ltda,2013,Meios de Hospedagem\nBeta,2010,Meios de Hospedagem\nBeta,2011,Meios de Hospedagem\nGamma,2012,"Restaurantes, barracas de praia, bares e similares"`).records;
}

test('normaliza espaços, tipos e remove duplicidade exata', () => {
  const result = normalizeCsv('EMPRESA,ANO,TIPO\n Alpha ,2010, meios de hospedagem \nAlpha,2010,Meios de Hospedagem\nVazia,,Meios de Hospedagem\nFora,2200,Meios de Hospedagem');
  assert.equal(result.records.length, 1);
  assert.equal(result.log.filter((item) => item.action === 'deduplicated').length, 1);
  assert.equal(result.log.filter((item) => item.action === 'rejected').length, 2);
});

test('preserva intervalos como períodos únicos', () => {
  const result = normalizeCsv('EMPRESA,ANO,TIPO\nAlpha,2009 / 2010,Meios de Hospedagem\nAlpha,2011 / 2012,Meios de Hospedagem');
  assert.deepEqual(result.records.map((record) => record.periodo), ['2009 / 2010', '2011 / 2012']);
  assert.deepEqual(result.records.map((record) => record.periodoInicio), [2009, 2011]);
  assert.equal(result.records[0].periodoFim, 2010);
});

test('filtro de período não inclui registros fora do recorte', () => {
  const records = normalizeCsv('EMPRESA,ANO,TIPO\nAlpha,2009 / 2010,Meios de Hospedagem\nAlpha,2011 / 2012,Meios de Hospedagem\nBeta,2011 / 2012,Meios de Hospedagem').records;
  const filtered = filterRecords(records, { year: '2011 / 2012' });
  assert.deepEqual(filtered.map((record) => record.periodo), ['2011 / 2012', '2011 / 2012']);
});

test('aceita anos novos e consolida a grafia segura de categoria', () => {
  const result = normalizeCsv('EMPRESA,ANO,TIPO\nNova Empresa,2025,SERVIRÇOS DE ESTÉTICA\nOutra Empresa,2021,HOSPEDAGEM  ');
  assert.equal(result.records.length, 2);
  assert.deepEqual([...new Set(result.records.map((item) => item.tipo))], ['SERVIÇOS DE ESTÉTICA', 'HOSPEDAGEM']);
  assert.equal(result.log.filter((item) => item.action === 'corrected').length, 2);
});

test('calcula KPIs, anual, tipo e recorrência', () => {
  const result = calculateDashboard(sample());
  assert.equal(result.kpis.totalParticipacoes, 6);
  assert.equal(result.kpis.empresasUnicas, 3);
  assert.equal(result.kpis.empresasMaisDe10Premios, 0);
  assert.equal(result.kpis.empresasRecorrentes, 2);
  assert.equal(result.kpis.empresasNovas, 3);
  assert.deepEqual(result.annual.map((item) => item.total), [2, 2, 1, 1]);
  assert.equal(result.segments.find((item) => item.tipo === 'Meios de Hospedagem').total, 5);
});

test('conta empresas com 10 ou mais prêmios', () => {
  const rows = ['EMPRESA,ANO,TIPO', ...Array.from({ length: 10 }, (_, index) => `Premiada,${2010 + index},Meios de Hospedagem`)].join('\n');
  const result = calculateDashboard(normalizeCsv(rows).records);
  assert.equal(result.kpis.empresasMaisDe10Premios, 1);
});

test('ranking de empresas ordena por prêmios e preserva o ranking geral com empresa selecionada', () => {
  const rows = [
    'EMPRESA,ANO,TIPO',
    'Beta,2010,Meios de Hospedagem',
    'Beta,2011,Meios de Hospedagem',
    'Beta,2012,Meios de Hospedagem',
    'Alpha,2010,Meios de Hospedagem',
    'Alpha,2011,Meios de Hospedagem',
    'Alpha,2012,Meios de Hospedagem',
    'Gamma,2010,Meios de Hospedagem',
    'Gamma,2011,Meios de Hospedagem'
  ].join('\n');
  const result = calculateDashboard(normalizeCsv(rows).records, { company: 'Beta' });
  assert.equal(result.companies.length, 1);
  assert.deepEqual(result.ranking.map((item) => item.empresa), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(result.ranking.map((item) => item.position), [1, 1, 3]);
  assert.equal(result.rankingTotal, 3);
  assert.equal(result.selectedRanking.position, 1);
});

test('ranking inclui todos os empatados na posição 10', () => {
  const rows = ['EMPRESA,ANO,TIPO'];
  for (let companyIndex = 0; companyIndex < 11; companyIndex += 1) {
    const awards = Math.max(3, 12 - companyIndex);
    for (let awardIndex = 0; awardIndex < awards; awardIndex += 1) rows.push(`Empresa ${companyIndex},${2010 + awardIndex},Meios de Hospedagem`);
  }
  const result = calculateDashboard(normalizeCsv(rows.join('\n')).records);
  assert.equal(result.ranking.length, 11);
  assert.deepEqual(result.ranking.slice(-2).map((item) => item.position), [10, 10]);
});

test('sequência consecutiva e participações por empresa', () => {
  assert.equal(consecutiveYears([2012, 2013, 2014, 2016, 2017]), 3);
  const item = calculateDashboard(sample()).companies.find((company) => company.empresa === 'Alpha Ltda');
  assert.deepEqual(item.anos, [2010, 2011, 2013]);
  assert.equal(item.primeira, '2010'); assert.equal(item.ultima, '2013'); assert.equal(item.sequencia, 2);
});

test('filtro de recorrência usa anos distintos, não linhas', () => {
  const records = sample().concat([{ id:'gamma-extra',empresa:'Gamma',empresaKey:'gamma',ano:2012,tipo:'Restaurantes, barracas de praia, bares e similares',tipoKey:'restaurantes, barracas de praia, bares e similares' }]);
  assert.equal(filterRecords(records, { recurrence: 'recurring' }).filter((r) => r.empresa === 'Gamma').length, 0);
});

test('retenção e comparação entre anos', () => {
  const result = calculateDashboard(sample());
  assert.equal(result.retention.find((row) => row.from === '2010').horizons[0].retained, 2);
  const resultCompare = compare(sample(), 2010, 2011);
  assert.deepEqual(resultCompare.both, ['Alpha Ltda', 'Beta']);
  assert.equal(resultCompare.retention, 100);
});
