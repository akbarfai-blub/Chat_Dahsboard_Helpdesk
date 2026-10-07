import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

async function main() {
  let runTestMigrations;
  try {
    const runnerModule = require("../.test-build/tests/utils/test-migration-runner.js");
    runTestMigrations = runnerModule.runTestMigrations;
  } catch {
    console.error("Test migration runner not built. Run 'npm run test:unit' or 'tsc -p tsconfig.test.json' first.");
    process.exit(1);
  }

  try {
    const result = await runTestMigrations();
    console.log("Test migration execution succeeded with verified guard:");
    console.log(`- Target Database: ${result.targetDatabase}`);
    console.log(`- Marker Verified: ${result.markerVerified}`);
    console.log(`- Applied (${result.applied.length}): ${result.applied.length > 0 ? result.applied.join(", ") : "None (all up-to-date)"}`);
    console.log(`- Skipped (${result.skipped.length}): Already recorded in schema_migrations`);
  } catch (err) {
    console.error("Test migration failed closed:");
    console.error(err.message);
    process.exit(1);
  }
}

main();
