const EmbeddedPostgres = require('embedded-postgres').default;
const path = require('path');

async function main() {
  console.log('Initializing embedded postgres on port 5433...');
  const dataDir = path.resolve(__dirname, '../.local-postgres-data');
  const pg = new EmbeddedPostgres({
    port: 5433,
    database: 'tradex',
    user: 'postgres',
    password: 'postgresPassword123!',
    dataDir: dataDir,
  });

  try {
    await pg.initialise();
  } catch (err) {
    console.log('Init skipped or already initialised:', err.message);
  }
  console.log('Starting...');
  await pg.start();
  console.log('PostgreSQL is running on localhost:5433!');
}

main().catch((err) => {
  console.error('Error starting pg:', err);
  process.exit(1);
});
