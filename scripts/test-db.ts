import { pool } from ../src/db/pool.js;

async function main() {
  const db = await pool.query(SELECT
