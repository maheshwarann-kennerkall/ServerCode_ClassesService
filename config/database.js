const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'school_management',
  password: process.env.DB_PASSWORD || 'ubuntu',
  port: process.env.DB_PORT || 5432,
  max: 2,
  min: 2,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 60000,
  statement_timeout: 60000,
  query_timeout: 60000,
  keepAlive: true,
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
});

pool.on('acquire', () => {
  console.log('🔄 ClassesService: Connection acquired from pool');
});

pool.on('release', () => {
  console.log('🔄 ClassesService: Connection released back to pool');
});

module.exports = pool;