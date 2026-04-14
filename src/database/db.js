const { Pool } = require('pg');

/**
 * PostgreSQL Database Service
 * Replaces SQLite for better production scalability and persistence.
 */
const connectionString = process.env.DATABASE_URL;

class Database {
  constructor() {
    this.pool = new Pool({
      connectionString: connectionString,
      ssl: {
        rejectUnauthorized: false // Required for Render/Cloud database connections
      }
    });
  }

  /**
   * Initializes connection and creates schema
   */
  async connect() {
    try {
      // Test connectivity
      await this.pool.query('SELECT NOW()');
      console.log('✓ Connected to PostgreSQL database successfully');
      
      await this.initializeTables();
    } catch (err) {
      console.error('❌ Database connection failed:', err.message);
      if (!connectionString) {
        console.error('⚠️ Warning: DATABASE_URL is missing from environment variables.');
      }
      throw err;
    }
  }

  /**
   * Creates the relational schema with PostgreSQL-optimized types
   */
  async initializeTables() {
    const createTablesSQL = `
      -- Admin/User accounts
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT,
        full_name TEXT,
        is_active INTEGER DEFAULT 1,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Users/Customers
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phone_number TEXT UNIQUE NOT NULL,
        name TEXT,
        subscription_status TEXT DEFAULT 'active',
        subscription_start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        subscription_end_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Commodities/Products
      CREATE TABLE IF NOT EXISTS commodities (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price DECIMAL(12, 2) NOT NULL,
        currency TEXT DEFAULT 'NGN',
        image_path TEXT,
        category TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Customer-Product mapping
      CREATE TABLE IF NOT EXISTS user_commodities (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        commodity_id INTEGER REFERENCES commodities(id) ON DELETE CASCADE,
        custom_price DECIMAL(12, 2),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Conversation history
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_phone TEXT NOT NULL,
        user_message TEXT,
        bot_response TEXT,
        message_type TEXT DEFAULT 'text',
        image_path TEXT,
        processed INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- WhatsApp Account Linking Sessions
      CREATE TABLE IF NOT EXISTS linking_sessions (
        id SERIAL PRIMARY KEY,
        session_id TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL,
        pin TEXT NOT NULL,
        qr_code TEXT,
        linked INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        linked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Payment Requests
      CREATE TABLE IF NOT EXISTS payment_requests (
        id SERIAL PRIMARY KEY,
        phone_number TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        reference_id TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verified_at TIMESTAMP
      );

      -- Optimized Indexes
      CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(user_phone);
      CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
      CREATE INDEX IF NOT EXISTS idx_linking_session_id ON linking_sessions(session_id);
    `;

    try {
      await this.pool.query(createTablesSQL);
      console.log('✓ PostgreSQL schema and indexes initialized');
    } catch (err) {
      console.error('❌ Schema initialization error:', err.message);
    }
  }

  /**
   * Helper to convert SQLite "?" placeholders to Postgres "$n" 
   * to ensure compatibility with existing service code.
   */
  convertSql(sql) {
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
  }

  async get(sql, params = []) {
    const res = await this.pool.query(this.convertSql(sql), params);
    return res.rows[0];
  }

  async all(sql, params = []) {
    const res = await this.pool.query(this.convertSql(sql), params);
    return res.rows;
  }

  async run(sql, params = []) {
    return await this.pool.query(this.convertSql(sql), params);
  }

  /**
   * Supports the .prepare() pattern used in your business logic
   */
  prepare(sql) {
    const self = this;
    return {
      run: async (...params) => self.run(sql, params),
      get: async (...params) => self.get(sql, params),
      all: async (...params) => self.all(sql, params)
    };
  }

  async close() {
    await this.pool.end();
    console.log('✓ Database connection pool closed');
  }
}

module.exports = new Database();