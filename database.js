const { Pool } = require('pg');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// ============ DETECT MODE: PostgreSQL (production) or SQLite (local) ============
const isProduction = !!process.env.DATABASE_URL;

let pool = null;  // PostgreSQL
let sqliteDb = null;  // SQLite

// ============ INIT ============
async function initDatabase() {
  if (isProduction) {
    return initPostgres();
  } else {
    return initSQLite();
  }
}

// ============ POSTGRESQL (Render / Production) ============
async function initPostgres() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS programs (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        image TEXT,
        download_link TEXT NOT NULL,
        category TEXT DEFAULT 'General',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL
      )
    `);

    // Default admin
    const adminCheck = await client.query("SELECT id FROM admin WHERE username = 'Ilias'");
    if (adminCheck.rows.length === 0) {
      const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Ilias1998', 10);
      await client.query("INSERT INTO admin (username, password) VALUES ($1, $2)", ['Ilias', hash]);
    }

    // Default categories
    const cats = ['General', 'Utilities', 'Development', 'Design', 'Security', 'Media', 'Games', 'Education'];
    for (const cat of cats) {
      await client.query("INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [cat]);
    }
  } finally {
    client.release();
  }

  console.log('  📦 Database: PostgreSQL (Production)');
  return pool;
}

// ============ SQLITE (Local Development) ============
async function initSQLite() {
  const SQL = await initSqlJs();
  const DB_PATH = path.join(__dirname, 'data.db');

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    sqliteDb = new SQL.Database(buffer);
  } else {
    sqliteDb = new SQL.Database();
  }

  sqliteDb.run(`CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS programs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, image TEXT, download_link TEXT NOT NULL, category TEXT DEFAULT 'General', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)`);

  const adminCheck = sqliteDb.exec("SELECT id FROM admin WHERE username = 'Ilias'");
  if (adminCheck.length === 0 || adminCheck[0].values.length === 0) {
    const hash = bcrypt.hashSync('Ilias1998', 10);
    sqliteDb.run("INSERT INTO admin (username, password) VALUES (?, ?)", ['Ilias', hash]);
  }

  const defaultCats = ['General', 'Utilities', 'Development', 'Design', 'Security', 'Media', 'Games', 'Education'];
  for (const cat of defaultCats) {
    try { sqliteDb.run("INSERT OR IGNORE INTO categories (name) VALUES (?)", [cat]); } catch (e) {}
  }

  saveSQLite();
  console.log('  📦 Database: SQLite (Local)');
  return sqliteDb;
}

function saveSQLite() {
  if (!sqliteDb) return;
  const data = sqliteDb.export();
  fs.writeFileSync(path.join(__dirname, 'data.db'), Buffer.from(data));
}

// ============ UNIVERSAL QUERY HELPERS ============

async function queryAll(sql, params = []) {
  if (isProduction) {
    // Convert ? placeholders to $1, $2, etc for PostgreSQL
    const pgSql = convertPlaceholders(sql);
    const result = await pool.query(pgSql, params);
    return result.rows;
  } else {
    const stmt = sqliteDb.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  }
}

async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

async function runSql(sql, params = []) {
  if (isProduction) {
    const pgSql = convertPlaceholders(sql);
    const result = await pool.query(pgSql + ' RETURNING *', params);
    return { lastId: result.rows[0]?.id };
  } else {
    sqliteDb.run(sql, params);
    saveSQLite();
    const res = sqliteDb.exec("SELECT last_insert_rowid()");
    return { lastId: res[0]?.values[0]?.[0] };
  }
}

async function runSqlNoReturn(sql, params = []) {
  if (isProduction) {
    const pgSql = convertPlaceholders(sql);
    await pool.query(pgSql, params);
  } else {
    sqliteDb.run(sql, params);
    saveSQLite();
  }
}

// Convert SQLite ? placeholders to PostgreSQL $1, $2, ...
function convertPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

module.exports = { initDatabase, queryAll, queryOne, runSql, runSqlNoReturn };
