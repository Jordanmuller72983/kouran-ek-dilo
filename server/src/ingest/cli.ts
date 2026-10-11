// One-off ingestion: `npm run ingest` (all sources) or `npm run ingest -- ceb`
import { runIngest } from './index.ts';

const only = process.argv.slice(2);
const results = await runIngest(only.length ? only : undefined);
console.table(results);
process.exitCode = results.some((r) => r.error) ? 1 : 0;
