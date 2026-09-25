const EmbeddedPostgres = require('embedded-postgres').default;
const path = require('path');

async function main() {
  console.log('Initializing embedded postgres...');
  const pg = new EmbeddedPostgres({
    port: 5432,
    database: 'tradex',
    user: 'postgres',
    password: 'postgresPassword123!',
    dataDir: path.resolve(__dirname, '../.local-postgres-data'),
  });

  await pg.initialise();
  console.log('Initialised! Starting...');
  await pg.start();
  console.log('PostgreSQL is running on localhost:5432!');
}
main().catch(console.error);
