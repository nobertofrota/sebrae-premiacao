const path = require('node:path');
const { importCsv } = require('../src/normalizer');

const root = path.resolve(__dirname, '..');
const result = importCsv({
  inputPath: path.join(root, 'PREMIO SEBRAE - CONSOLIDADO OFICIAL.csv'),
  outputPath: path.join(root, 'data', 'normalized.json'),
  logPath: path.join(root, 'data', 'import.log')
});
const rejected = result.log.filter((item) => item.action === 'rejected').length;
const deduplicated = result.log.filter((item) => item.action === 'deduplicated').length;
console.log(`Importação concluída: ${result.records.length} registros válidos, ${deduplicated} duplicidade(s) removida(s), ${rejected} rejeição(ões).`);
