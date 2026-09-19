const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { importCsv } = require('./src/normalizer');
const { calculateDashboard, compare, filterRecords, getYears } = require('./src/analytics');

const root = __dirname;
const sourcePath = path.join(root, 'PREMIO SEBRAE - CONSOLIDADO OFICIAL.csv');
const dataPath = path.join(root, 'data', 'normalized.json');
let dataPackage;
let allRecords = [];
let sourceVersion = '';
let sourceUpdatedAt = null;

function getSourceVersion() {
  const stat = fs.statSync(sourcePath);
  return `${stat.mtimeMs}:${stat.size}`;
}

function importLatestData() {
  const result = importCsv({ inputPath: sourcePath, outputPath: dataPath, logPath: path.join(root, 'data', 'import.log') });
  dataPackage = result;
  allRecords = result.records;
  sourceVersion = getSourceVersion();
  sourceUpdatedAt = fs.statSync(sourcePath).mtime.toISOString();
  console.log(`Fonte atualizada: ${allRecords.length} registros válidos.`);
}

function refreshDataIfChanged() {
  const currentVersion = getSourceVersion();
  if (!dataPackage || currentVersion !== sourceVersion) importLatestData();
}

importLatestData();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function filtersFrom(url) {
  const params = url.searchParams;
  return { fromYear: params.get('fromYear'), toYear: params.get('toYear'), year: params.get('year'), types: params.getAll('type').length ? params.getAll('type') : params.get('types'), company: params.get('company'), search: params.get('search'), recurrence: params.get('recurrence'), minParticipations: params.get('minParticipations'), selectedCompany: params.get('selectedCompany') };
}
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function send(res, status, body, type = 'application/json; charset=utf-8') { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try { refreshDataIfChanged(); } catch (error) { return send(res, 500, JSON.stringify({ error: 'Falha ao importar a fonte CSV.', detail: error.message })); }
  if (url.pathname === '/api/dashboard') { const dashboard = calculateDashboard(allRecords, filtersFrom(url)); dashboard.meta.duplicateRowsRemoved = (dataPackage.log || []).filter((item) => item.action === 'deduplicated').length; dashboard.meta.sourceFile = path.basename(sourcePath); dashboard.meta.sourceUpdatedAt = sourceUpdatedAt; return send(res, 200, JSON.stringify(dashboard)); }
  if (url.pathname === '/api/compare') {
    const filtered = filterRecords(allRecords, filtersFrom(url));
    const years = getYears(allRecords);
    return send(res, 200, JSON.stringify(compare(filtered, url.searchParams.get('yearA') || years.at(-2), url.searchParams.get('yearB') || years.at(-1))));
  }
  if (url.pathname === '/api/export.csv') {
    const filtered = filterRecords(allRecords, filtersFrom(url));
    const lines = ['EMPRESA,ANO,TIPO', ...filtered.map((record) => [record.empresa, record.ano, record.tipo].map(csvCell).join(','))];
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="premio-sebrae-filtrado.csv"' }); res.end('\uFEFF' + lines.join('\r\n')); return;
  }
  const requested = url.pathname === '/' ? '/public/index.html' : `/public${url.pathname}`;
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(path.join(root, 'public'))) return send(res, 403, JSON.stringify({ error: 'forbidden' }));
  fs.readFile(filePath, (error, content) => error ? send(res, 404, 'Not found', 'text/plain; charset=utf-8') : send(res, 200, content, mime[path.extname(filePath)] || 'application/octet-stream'));
});

const port = Number(process.env.PORT) || 3000;
if (require.main === module) server.listen(port, () => console.log(`Dashboard disponível em http://localhost:${port}`));
module.exports = { server };
