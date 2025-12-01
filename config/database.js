const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'school_management',
  password: process.env.DB_PASSWORD || 'ubuntu',
  port: process.env.DB_PORT || 5432,
  max: 20,
  min: 2,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  query_timeout: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  ssl: {
    rejectUnauthorized: false,
    servername: process.env.DB_HOST || 'localhost'
  },
});

// Test the connection
pool.on('connect', () => {
  console.log('📊 ClassesService: Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ ClassesService: Database connection error:', err);
  process.exit(-1);
});

module.exports = pool;