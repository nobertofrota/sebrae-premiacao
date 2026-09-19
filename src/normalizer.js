const fs = require('node:fs');
const path = require('node:path');

const VALID_YEARS = new Set();
const CANONICAL_TYPES = [];
const TYPE_ALIASES = new Map([
  ['servircos de estetica', 'SERVIÇOS DE ESTÉTICA']
]);

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalizePeriod(value) {
  const label = cleanText(value);
  const parts = label.split('/').map((part) => Number(cleanText(part)));
  if (!parts.length || parts.some((part) => !Number.isInteger(part) || part < 1900 || part > 2100)) return null;
  if (parts.length === 1) return { label: String(parts[0]), inicio: parts[0], fim: parts[0] };
  if (parts.length === 2 && parts[0] <= parts[1]) return { label: `${parts[0]} / ${parts[1]}`, inicio: parts[0], fim: parts[1] };
  return null;
}

function normalizeCsv(csvText) {
  const rows = parseCsv(csvText);
  const header = (rows.shift() || []).map(cleanText).map((value) => value.toUpperCase());
  const indexes = { EMPRESA: header.indexOf('EMPRESA'), ANO: header.indexOf('ANO'), TIPO: header.indexOf('TIPO') };
  const log = [];
  const seen = new Set();
  const records = [];

  if (Object.values(indexes).some((index) => index < 0)) throw new Error('Cabeçalho inválido: esperado EMPRESA, ANO e TIPO.');

  const typeLabels = new Map();
  for (const raw of rows) {
    const label = cleanText(raw[indexes.TIPO]);
    const canonicalLabel = TYPE_ALIASES.get(fold(label)) || label;
    if (canonicalLabel && !typeLabels.has(fold(canonicalLabel))) typeLabels.set(fold(canonicalLabel), canonicalLabel);
  }

  rows.forEach((raw, index) => {
    const line = index + 2;
    const original = { empresa: raw[indexes.EMPRESA], ano: raw[indexes.ANO], tipo: raw[indexes.TIPO] };
    const empresa = cleanText(original.empresa);
    const periodoInput = cleanText(original.ano);
    const periodo = normalizePeriod(periodoInput);
    const tipoInput = cleanText(original.tipo);
    const tipo = typeLabels.get(fold(TYPE_ALIASES.get(fold(tipoInput)) || tipoInput)) || '';

    if (!empresa || !periodoInput || !tipoInput) {
      log.push({ line, action: 'rejected', reason: 'campo obrigatório vazio', original });
      return;
    }
    if (!periodo) {
      log.push({ line, action: 'rejected', reason: 'período inválido', original });
      return;
    }
    const empresaKey = fold(empresa);
    const periodoKey = fold(periodo.label);
    const tipoKey = fold(tipo);
    const key = `${empresaKey}|${periodoKey}|${tipoKey}`;
    if (seen.has(key)) {
      log.push({ line, action: 'deduplicated', reason: 'combinação EMPRESA+PERÍODO+TIPO repetida após normalização', original });
      return;
    }
    seen.add(key);
    if (empresa !== original.empresa || periodo.label !== original.ano || tipo !== original.tipo) {
      log.push({ line, action: 'corrected', reason: 'trim/canonicalização de campo', original, normalized: { empresa, periodo: periodo.label, tipo } });
    }
    records.push({ id: key, empresa, empresaKey, ano: periodo.label, periodo: periodo.label, periodoKey, periodoInicio: periodo.inicio, periodoFim: periodo.fim, tipo, tipoKey });
  });
  return { records, log, sourceRows: rows.length, header, types: [...typeLabels.values()] };
}

function importCsv({ inputPath, outputPath, logPath }) {
  const result = normalizeCsv(fs.readFileSync(inputPath, 'utf8'));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2));
  fs.writeFileSync(logPath, result.log.map((item) => JSON.stringify(item)).join('\n') + (result.log.length ? '\n' : ''));
  return result;
}

module.exports = { CANONICAL_TYPES, VALID_YEARS, TYPE_ALIASES, fold, parseCsv, cleanText, normalizePeriod, normalizeCsv, importCsv };
