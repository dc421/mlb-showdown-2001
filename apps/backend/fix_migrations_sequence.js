const { Pool } = require('pg');
const path = require('path');

// Load environment variables if not in production
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixSequence() {
  try {
    console.log('Attempting to fix pgmigrations sequence...');

    // Check if table exists
    const tableCheck = await pool.query("SELECT to_regclass('public.pgmigrations')");
    if (!tableCheck.rows[0].to_regclass) {
      console.log('pgmigrations table does not exist. Skipping sequence fix.');
      return;
    }

    // Check if the sequence exists using pg_get_serial_sequence for robustness
    // This works for both SERIAL and IDENTITY columns
    const seqNameQuery = "SELECT pg_get_serial_sequence('public.pgmigrations', 'id') as seq_name";
    const seqResult = await pool.query(seqNameQuery);
    const seqName = seqResult.rows[0].seq_name;

    if (!seqName) {
        console.log('No sequence found for pgmigrations.id. Skipping sequence fix.');
        return;
    }

    // Update the sequence to the max id
    // COALESCE(MAX(id), 0) + 1? No, setval sets the *current* value (if is_called is true) or next?
    // setval(seq, val) sets the sequence's current value. The next nextval will be val + 1 (if is_called is true by default).
    // So setting it to MAX(id) means next insert gets MAX(id) + 1, which is correct (no conflict).

    // However, if table is empty, MAX(id) is null.
    const maxIdResult = await pool.query("SELECT MAX(id) FROM pgmigrations");
    const maxId = maxIdResult.rows[0].max;

    if (maxId === null) {
        console.log('pgmigrations table is empty. No need to fix sequence.');
        return;
    }

    const query = `SELECT setval('${seqName}', ${maxId});`;
    await pool.query(query);
    console.log(`Successfully updated sequence ${seqName} to ${maxId}.`);
  } catch (error) {
    console.error('Error fixing sequence:', error);
    // We don't exit with error 1 because we want the build to proceed and attempt migration
    // even if this fix fails (e.g. permission issues).
  } finally {
    await pool.end();
  }
}

fixSequence();
