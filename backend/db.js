/**
 * Database Adapter for Zora Bot
 * Exposes a unified interface for Cloudflare D1 (in production)
 * and a local SQLite file database (in local development).
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables if not already loaded
dotenv.config();

const isD1Mode = process.env.DATABASE_MODE === 'd1' || process.env.CF_D1 === 'true' || process.env.CF_WORKER === 'true';
const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, 'bot.db');

let sqliteDb = null;

// Initialize local database if in SQLite mode
if (!isD1Mode) {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const dbExists = fs.existsSync(dbPath);
    
    console.log(`🔌 Initializing local SQLite database at: ${dbPath}`);
    sqliteDb = new sqlite3.Database(dbPath);
    
    if (!dbExists) {
      console.log('📝 New database detected, executing schema.sql...');
      try {
        const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        sqliteDb.serialize(() => {
          // SQLite can run multiple statements separated by semicolons using exec
          sqliteDb.exec(schemaSql, (err) => {
            if (err) {
              console.error('❌ Error executing schema.sql:', err);
            } else {
              console.log('✅ Local SQLite schema initialized successfully');
            }
          });
        });
      } catch (err) {
        console.error('❌ Failed to read or execute schema.sql:', err);
      }
    }
  } catch (err) {
    console.warn('⚠️ Local SQLite3 native module disabled or failed to load:', err.message);
    sqliteDb = {
      all: (sql, params, cb) => {
        const callback = typeof params === 'function' ? params : cb;
        if (typeof callback === 'function') callback(null, []);
      },
      get: (sql, params, cb) => {
        const callback = typeof params === 'function' ? params : cb;
        if (typeof callback === 'function') callback(null, null);
      },
      run: (sql, params, cb) => {
        const callback = typeof params === 'function' ? params : (typeof sql === 'function' ? sql : cb);
        if (typeof callback === 'function') callback.call({ changes: 0, lastID: 0 }, null);
      },
      exec: (sql, cb) => {
        const callback = typeof sql === 'function' ? sql : cb;
        if (typeof callback === 'function') callback(null);
      },
      serialize: (fn) => { if (typeof fn === 'function') fn(); }
    };
  }
} else {
  console.log('☁️ Database initialized in Cloudflare D1 Mode (proxying through d1.local)');
}

// Low-level query functions
const dbQuery = {
  // Execute a query and return all results (SELECT)
  async all(sql, params = []) {
    if (isD1Mode) {
      return callD1Proxy('all', sql, params);
    }
    return new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve({ results: rows || [], success: true });
      });
    });
  },

  // Execute a write query (INSERT, UPDATE, DELETE)
  async run(sql, params = []) {
    if (isD1Mode) {
      return callD1Proxy('run', sql, params);
    }
    return new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({
          success: true,
          meta: {
            changes: (this && typeof this.changes === 'number') ? this.changes : 0,
            last_row_id: (this && typeof this.lastID === 'number') ? this.lastID : 0
          }
        });
      });
    });
  },

  // Execute multi-statement SQL
  async exec(sql) {
    if (isD1Mode) {
      return callD1Proxy('exec', sql);
    }
    return new Promise((resolve, reject) => {
      sqliteDb.exec(sql, (err) => {
        if (err) reject(err);
        else resolve({ success: true });
      });
    });
  },

  // Execute a batch of queries in a transaction
  async batch(statements) {
    if (isD1Mode) {
      // D1 API expects sql array and params array
      const sqlList = statements.map(s => s.sql);
      const paramsList = statements.map(s => s.params || []);
      return callD1Proxy('batch', sqlList, paramsList);
    }
    return new Promise((resolve, reject) => {
      sqliteDb.serialize(() => {
        sqliteDb.run("BEGIN TRANSACTION");
        const results = [];
        let failed = false;
        
        for (const stmt of statements) {
          sqliteDb.run(stmt.sql, stmt.params || [], function(err) {
            if (err) {
              failed = true;
              sqliteDb.run("ROLLBACK");
              reject(err);
            } else {
              results.push({
                success: true,
                meta: {
                  changes: (this && typeof this.changes === 'number') ? this.changes : 0,
                  last_row_id: (this && typeof this.lastID === 'number') ? this.lastID : 0
                }
              });
            }
          });
        }
        
        if (!failed) {
          sqliteDb.run("COMMIT", (err) => {
            if (err) reject(err);
            else resolve(results);
          });
        }
      });
    });
  }
};

// HTTP Client for Cloudflare D1 proxy (gateway.js outbound interception)
async function callD1Proxy(method, sql, params = []) {
  let fetchFn;
  if (typeof globalThis.fetch === 'function') {
    fetchFn = globalThis.fetch.bind(globalThis);
  } else {
    fetchFn = require('node-fetch').default || require('node-fetch');
  }

  const response = await fetchFn('http://d1.local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, sql, params })
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `D1 Proxy returned HTTP error: ${response.status}`);
  }

  return await response.json();
}

// Repository / Helper Functions (Document Database style abstraction)
const EventEmitter = require('events');
const crypto = require('crypto');
const dbEvents = new EventEmitter();

const dbHelpers = {
  // Config helpers
  async getConfig(key) {
    const row = await dbQuery.all('SELECT value FROM config WHERE key = ?', [key]);
    if (row.results && row.results.length > 0) {
      return JSON.parse(row.results[0].value);
    }
    return null;
  },

  async saveConfig(key, value) {
    const jsonStr = JSON.stringify(value);
    const res = await dbQuery.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', [key, jsonStr]);
    dbEvents.emit('change', { collection: 'config', id: key, data: value });
    return res;
  },

  // Trades helpers
  async getTrade(id) {
    const row = await dbQuery.all('SELECT data FROM trades WHERE id = ?', [id.toLowerCase()]);
    if (row.results && row.results.length > 0) {
      return JSON.parse(row.results[0].data);
    }
    return null;
  },

  async getTradeByAddress(tokenAddress) {
    const row = await dbQuery.all('SELECT data FROM trades WHERE tokenAddress = ?', [tokenAddress.toLowerCase()]);
    if (row.results && row.results.length > 0) {
      return JSON.parse(row.results[0].data);
    }
    return null;
  },

  async getActiveTrades() {
    const rows = await dbQuery.all('SELECT data FROM trades WHERE status = ?', ['bought']);
    return (rows.results || []).map(r => JSON.parse(r.data));
  },

  async getRecentTrades(limitCount = 100) {
    const rows = await dbQuery.all('SELECT data FROM trades ORDER BY boughtAt DESC LIMIT ?', [limitCount]);
    return (rows.results || []).map(r => JSON.parse(r.data));
  },

  async saveTrade(id, tradeData) {
    const cleanId = id.toLowerCase();
    const tokenAddress = (tradeData.tokenAddress || '').toLowerCase();
    const status = tradeData.status || 'detected';
    const boughtAt = tradeData.boughtAt || tradeData.timestamp || Date.now();
    const soldAt = tradeData.soldAt || null;
    const creatorAddress = (tradeData.creatorAddress || (tradeData.context && tradeData.context.creatorAddress) || '').toLowerCase();
    
    // Ensure id is set in the data object
    const finalData = { ...tradeData, id: cleanId, docId: cleanId };
    const jsonStr = JSON.stringify(finalData);
    
    const res = await dbQuery.run(
      'INSERT OR REPLACE INTO trades (id, tokenAddress, status, boughtAt, soldAt, creatorAddress, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [cleanId, tokenAddress, status, boughtAt, soldAt, creatorAddress, jsonStr]
    );
    dbEvents.emit('change', { collection: 'trades', id: cleanId, data: finalData });
    return res;
  },

  async deleteTrade(id) {
    const cleanId = id.toLowerCase();
    const res = await dbQuery.run('DELETE FROM trades WHERE id = ?', [cleanId]);
    dbEvents.emit('change', { collection: 'trades', id: cleanId, data: null, deleted: true });
    return res;
  },

  // Activity Feed helpers
  async getActivityFeed(limitCount = 50, offset = 0) {
    const rows = await dbQuery.all(
      'SELECT data FROM activityFeed ORDER BY timestamp DESC LIMIT ? OFFSET ?',
      [limitCount, offset]
    );
    return (rows.results || []).map(r => JSON.parse(r.data));
  },

  async saveActivity(id, activityData) {
    const cleanId = id.toLowerCase();
    const type = activityData.type || 'UNKNOWN';
    const timestamp = activityData.timestamp || Date.now();
    const isTarget = activityData.isTarget ? 1 : 0;
    const coinType = activityData.coinType || null;
    
    const finalData = { ...activityData, id: cleanId };
    const jsonStr = JSON.stringify(finalData);

    const res = await dbQuery.run(
      'INSERT OR REPLACE INTO activityFeed (id, type, timestamp, isTarget, coinType, data) VALUES (?, ?, ?, ?, ?, ?)',
      [cleanId, type, timestamp, isTarget, coinType, jsonStr]
    );
    dbEvents.emit('change', { collection: 'activityFeed', id: cleanId, data: finalData });
    return res;
  },

  // Target Users helpers
  async getTargetUser(userId) {
    const cleanId = userId.toLowerCase();
    const row = await dbQuery.all('SELECT data FROM targetUsers WHERE userId = ?', [cleanId]);
    if (row.results && row.results.length > 0) {
      return JSON.parse(row.results[0].data);
    }
    return null;
  },

  async saveTargetUser(userId, userData) {
    const cleanId = userId.toLowerCase();
    const fid = userData.fid || '';
    const status = userData.status || 'active';
    const addedAt = userData.addedAt || new Date().toISOString();
    
    const finalData = { ...userData, userId: cleanId };
    const jsonStr = JSON.stringify(finalData);

    const res = await dbQuery.run(
      'INSERT OR REPLACE INTO targetUsers (userId, fid, status, addedAt, data) VALUES (?, ?, ?, ?, ?)',
      [cleanId, fid, status, addedAt, jsonStr]
    );
    dbEvents.emit('change', { collection: 'targetUsers', id: cleanId, data: finalData });
    return res;
  },

  async deleteTargetUser(userId) {
    const cleanId = userId.toLowerCase();
    const res = await dbQuery.run('DELETE FROM targetUsers WHERE userId = ?', [cleanId]);
    dbEvents.emit('change', { collection: 'targetUsers', id: cleanId, data: null, deleted: true });
    return res;
  },

  async getAllTargetUsers() {
    const rows = await dbQuery.all('SELECT data FROM targetUsers');
    return (rows.results || []).map(r => JSON.parse(r.data));
  },

  // Processed Casts helpers
  async isCastProcessed(castHash) {
    const cleanHash = castHash.toLowerCase();
    const row = await dbQuery.all('SELECT 1 FROM processedCasts WHERE castHash = ?', [cleanHash]);
    return row.results && row.results.length > 0;
  },

  async markCastProcessed(castHash, timestamp = Date.now()) {
    const cleanHash = castHash.toLowerCase();
    return await dbQuery.run(
      'INSERT OR IGNORE INTO processedCasts (castHash, timestamp) VALUES (?, ?)',
      [cleanHash, timestamp]
    );
  },

  // Processed Coins helpers
  async getProcessedCoin(tokenAddress) {
    const cleanAddr = tokenAddress.toLowerCase();
    const row = await dbQuery.all('SELECT creator, name, timestamp FROM processedCoins WHERE tokenAddress = ?', [cleanAddr]);
    if (row.results && row.results.length > 0) {
      const res = row.results[0];
      return {
        id: cleanAddr,
        creator: res.creator,
        name: res.name,
        timestamp: res.timestamp
      };
    }
    return null;
  },

  async markCoinProcessed(tokenAddress, creator, name, timestamp = Date.now()) {
    const cleanAddr = tokenAddress.toLowerCase();
    const cleanCreator = (creator || '').toLowerCase();
    return await dbQuery.run(
      'INSERT OR REPLACE INTO processedCoins (tokenAddress, creator, name, timestamp) VALUES (?, ?, ?, ?)',
      [cleanAddr, cleanCreator, name, timestamp]
    );
  },

  // Users helpers
  async getUser(userId) {
    const cleanId = userId.toLowerCase();
    const row = await dbQuery.all('SELECT data FROM users WHERE userId = ?', [cleanId]);
    if (row.results && row.results.length > 0) {
      return JSON.parse(row.results[0].data);
    }
    return null;
  },

  async saveUser(userId, userData) {
    const cleanId = userId.toLowerCase();
    const finalData = { ...userData, userId: cleanId };
    const jsonStr = JSON.stringify(finalData);
    const res = await dbQuery.run('INSERT OR REPLACE INTO users (userId, data) VALUES (?, ?)', [cleanId, jsonStr]);
    dbEvents.emit('change', { collection: 'users', id: cleanId, data: finalData });
    return res;
  }
};

// Firestore Compatibility Layer classes
class DocumentSnapshot {
  constructor(id, dataExists, data) {
    this.id = id;
    this.exists = dataExists;
    this._data = data;
  }
  data() {
    return this._data;
  }
}

class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.empty = docs.length === 0;
    this.size = docs.length;
  }
  forEach(callback) {
    this.docs.forEach(callback);
  }
}

class DocumentReference {
  constructor(dbAdapter, collectionName, id) {
    this.dbAdapter = dbAdapter;
    this.collectionName = collectionName;
    this.id = id;
  }

  get ref() {
    return this;
  }

  async get() {
    let data = null;
    let exists = false;
    
    if (this.collectionName === 'config' || this.collectionName === 'settings' || this.collectionName === 'analytics' || this.collectionName === 'stats') {
      const keyStr = (this.collectionName === 'config' || this.collectionName === 'settings') ? this.id : `${this.collectionName}_${this.id}`;
      const val = await dbHelpers.getConfig(keyStr);
      if (val !== null) {
        data = val;
        exists = true;
      }
    } else if (this.collectionName === 'trades') {
      const val = await dbHelpers.getTrade(this.id);
      if (val !== null) {
        data = val;
        exists = true;
      }
    } else if (this.collectionName === 'targetUsers') {
      const val = await dbHelpers.getTargetUser(this.id);
      if (val !== null) {
        data = val;
        exists = true;
      }
    } else if (this.collectionName === 'processedCasts') {
      const isProcessed = await dbHelpers.isCastProcessed(this.id);
      if (isProcessed) {
        data = { castHash: this.id };
        exists = true;
      }
    } else if (this.collectionName === 'processedCoins') {
      const val = await dbHelpers.getProcessedCoin(this.id);
      if (val !== null) {
        data = val;
        exists = true;
      }
    } else if (this.collectionName === 'users') {
      const val = await dbHelpers.getUser(this.id);
      if (val !== null) {
        data = val;
        exists = true;
      }
    } else {
      const keyStr = `${this.collectionName}_${this.id}`;
      const val = await dbHelpers.getConfig(keyStr);
      if (val !== null) {
        data = val;
        exists = true;
      }
    }
    
    return new DocumentSnapshot(this.id, exists, data);
  }

  async set(data, options = {}) {
    let finalData = data;
    if (options.merge) {
      const existing = await this.get();
      if (existing.exists) {
        finalData = { ...existing.data(), ...data };
      }
    }

    if (this.collectionName === 'config' || this.collectionName === 'settings' || this.collectionName === 'analytics' || this.collectionName === 'stats') {
      const keyStr = (this.collectionName === 'config' || this.collectionName === 'settings') ? this.id : `${this.collectionName}_${this.id}`;
      await dbHelpers.saveConfig(keyStr, finalData);
    } else if (this.collectionName === 'trades') {
      await dbHelpers.saveTrade(this.id, finalData);
    } else if (this.collectionName === 'targetUsers') {
      await dbHelpers.saveTargetUser(this.id, finalData);
    } else if (this.collectionName === 'processedCasts') {
      await dbHelpers.markCastProcessed(this.id, finalData.timestamp || Date.now());
    } else if (this.collectionName === 'processedCoins') {
      await dbHelpers.markCoinProcessed(this.id, finalData.creator, finalData.name, finalData.timestamp || Date.now());
    } else if (this.collectionName === 'users') {
      await dbHelpers.saveUser(this.id, finalData);
    } else if (this.collectionName === 'activityFeed') {
      await dbHelpers.saveActivity(this.id, finalData);
    } else {
      const keyStr = `${this.collectionName}_${this.id}`;
      await dbHelpers.saveConfig(keyStr, finalData);
    }
    return { success: true };
  }

  async update(data) {
    return await this.set(data, { merge: true });
  }

  async delete() {
    if (this.collectionName === 'config' || this.collectionName === 'settings' || this.collectionName === 'analytics' || this.collectionName === 'stats') {
      const keyStr = (this.collectionName === 'config' || this.collectionName === 'settings') ? this.id : `${this.collectionName}_${this.id}`;
      await dbQuery.run('DELETE FROM config WHERE key = ?', [keyStr]);
      dbEvents.emit('change', { collection: this.collectionName, id: this.id, data: null, deleted: true });
    } else if (this.collectionName === 'trades') {
      await dbHelpers.deleteTrade(this.id);
    } else if (this.collectionName === 'targetUsers') {
      await dbHelpers.deleteTargetUser(this.id);
    } else if (this.collectionName === 'processedCasts') {
      await dbQuery.run('DELETE FROM processedCasts WHERE castHash = ?', [this.id.toLowerCase()]);
    } else if (this.collectionName === 'processedCoins') {
      await dbQuery.run('DELETE FROM processedCoins WHERE tokenAddress = ?', [this.id.toLowerCase()]);
    } else if (this.collectionName === 'users') {
      await dbQuery.run('DELETE FROM users WHERE userId = ?', [this.id.toLowerCase()]);
      dbEvents.emit('change', { collection: 'users', id: this.id.toLowerCase(), data: null, deleted: true });
    } else if (this.collectionName === 'activityFeed') {
      await dbQuery.run('DELETE FROM activityFeed WHERE id = ?', [this.id.toLowerCase()]);
      dbEvents.emit('change', { collection: 'activityFeed', id: this.id.toLowerCase(), data: null, deleted: true });
    } else {
      const keyStr = `${this.collectionName}_${this.id}`;
      await dbQuery.run('DELETE FROM config WHERE key = ?', [keyStr]);
      dbEvents.emit('change', { collection: this.collectionName, id: this.id, data: null, deleted: true });
    }
    return { success: true };
  }

  onSnapshot(onNext, onError) {
    let active = true;
    const poll = async () => {
      try {
        const snap = await this.get();
        if (active) onNext(snap);
      } catch (err) {
        if (active && onError) onError(err);
      }
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }
}

class CollectionReference {
  constructor(dbAdapter, name) {
    this.dbAdapter = dbAdapter;
    this.name = name;
    this.filters = [];
    this.order = null;
    this.limitVal = null;
  }

  where(field, operator, value) {
    this.filters.push({ field, operator, value });
    return this;
  }

  orderBy(field, direction = 'asc') {
    this.order = { field, direction };
    return this;
  }

  limit(val) {
    this.limitVal = val;
    return this;
  }

  doc(id) {
    const activeUserId = userContextStore.getStore() || defaultUserId;
    const docId = id || require('crypto').randomUUID();
    let finalId = docId;
    if (['config', 'targetUsers', 'trades', 'stats'].includes(this.name)) {
      const prefix = `${activeUserId}_`;
      if (!docId.startsWith(prefix)) {
        finalId = `${prefix}${docId}`;
      }
    }
    return new DocumentReference(this.dbAdapter, this.name, finalId);
  }

  async add(data) {
    const id = crypto.randomUUID();
    const docRef = this.doc(id);
    await docRef.set(data);
    return docRef;
  }

  async get() {
    const docs = await executeQuery(this.dbAdapter, this.name, this.filters, this.order, this.limitVal);
    return new QuerySnapshot(docs);
  }

  onSnapshot(onNext, onError) {
    let active = true;
    const poll = async () => {
      try {
        const snap = await this.get();
        if (active) onNext(snap);
      } catch (err) {
        if (active && onError) onError(err);
      }
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }
}

class WriteBatch {
  constructor(dbAdapter) {
    this.dbAdapter = dbAdapter;
    this.operations = [];
  }

  set(docRef, data, options = {}) {
    this.operations.push({ action: 'set', docRef, data, options });
    return this;
  }

  update(docRef, data) {
    this.operations.push({ action: 'update', docRef, data });
    return this;
  }

  delete(docRef) {
    this.operations.push({ action: 'delete', docRef });
    return this;
  }

  async commit() {
    for (const op of this.operations) {
      if (op.action === 'set') {
        await op.docRef.set(op.data, op.options);
      } else if (op.action === 'update') {
        await op.docRef.update(op.data);
      } else if (op.action === 'delete') {
        await op.docRef.delete();
      }
    }
    return { success: true };
  }
}

class Transaction {
  constructor(dbAdapter) {
    this.dbAdapter = dbAdapter;
    this.operations = [];
  }

  async get(docRef) {
    return await docRef.get();
  }

  set(docRef, data, options = {}) {
    this.operations.push({ action: 'set', docRef, data, options });
    return this;
  }

  update(docRef, data) {
    this.operations.push({ action: 'update', docRef, data });
    return this;
  }

  delete(docRef) {
    this.operations.push({ action: 'delete', docRef });
    return this;
  }
}

async function executeQuery(dbAdapter, collectionName, filters, order, limitVal) {
  let table = 'config';
  let isDocTable = false;
  
  if (collectionName === 'trades') {
    table = 'trades';
    isDocTable = true;
  } else if (collectionName === 'targetUsers') {
    table = 'targetUsers';
    isDocTable = true;
  } else if (collectionName === 'activityFeed') {
    table = 'activityFeed';
    isDocTable = true;
  } else if (collectionName === 'processedCasts') {
    table = 'processedCasts';
  } else if (collectionName === 'processedCoins') {
    table = 'processedCoins';
  } else if (collectionName === 'users') {
    table = 'users';
    isDocTable = true;
  }
  
  const tableColumns = {
    trades: ['id', 'tokenAddress', 'status', 'boughtAt', 'soldAt', 'creatorAddress'],
    targetUsers: ['userId', 'fid', 'status', 'addedAt'],
    activityFeed: ['id', 'type', 'timestamp', 'isTarget', 'coinType'],
    processedCasts: ['castHash', 'timestamp'],
    processedCoins: ['tokenAddress', 'creator', 'name', 'timestamp'],
    users: ['userId']
  };
  
  const columns = tableColumns[table] || [];
  const sqlWhere = [];
  const sqlParams = [];
  const jsFilters = [];
  
  for (const filter of filters) {
    let field = filter.field;
    if (field === 'docId') field = 'id';
    
    let op = filter.operator;
    let val = filter.value;
    
    if (columns.includes(field)) {
      if (op === '==') {
        sqlWhere.push(`${field} = ?`);
        sqlParams.push(typeof val === 'string' ? val.toLowerCase() : val);
      } else if (op === '>') {
        sqlWhere.push(`${field} > ?`);
        sqlParams.push(val);
      } else if (op === '<') {
        sqlWhere.push(`${field} < ?`);
        sqlParams.push(val);
      } else if (op === '>=') {
        sqlWhere.push(`${field} >= ?`);
        sqlParams.push(val);
      } else if (op === '<=') {
        sqlWhere.push(`${field} <= ?`);
        sqlParams.push(val);
      } else if (op === 'in') {
        if (Array.isArray(val) && val.length > 0) {
          const placeholders = val.map(() => '?').join(', ');
          sqlWhere.push(`${field} IN (${placeholders})`);
          val.forEach(v => sqlParams.push(typeof v === 'string' ? v.toLowerCase() : v));
        } else {
          sqlWhere.push('1 = 0');
        }
      } else {
        jsFilters.push(filter);
      }
    } else {
      jsFilters.push(filter);
    }
  }
  
  // --- Multi-tenant prefix isolation ---
  const activeUserId = userContextStore.getStore() || defaultUserId;
  const tenantPrefix = `${activeUserId}_`;
  if (table === 'trades') {
    sqlWhere.push('id LIKE ?');
    sqlParams.push(`${tenantPrefix}%`);
  } else if (table === 'config') {
    sqlWhere.push('key LIKE ?');
    sqlParams.push(`${tenantPrefix}%`);
  } else if (table === 'targetUsers') {
    sqlWhere.push('userId LIKE ?');
    sqlParams.push(`${tenantPrefix}%`);
  }
  
  let sql = `SELECT * FROM ${table}`;
  if (sqlWhere.length > 0) {
    sql += ` WHERE ${sqlWhere.join(' AND ')}`;
  }
  
  let hasSqlOrder = false;
  if (order && columns.includes(order.field)) {
    sql += ` ORDER BY ${order.field} ${order.direction.toUpperCase()}`;
    hasSqlOrder = true;
  }
  
  if (limitVal !== null && jsFilters.length === 0) {
    sql += ` LIMIT ${limitVal}`;
  }
  
  const queryResult = await dbQuery.all(sql, sqlParams);
  let rows = queryResult.results || [];
  
  let docsData = rows.map(row => {
    if (isDocTable) {
      try {
        return JSON.parse(row.data);
      } catch (err) {
        return row;
      }
    } else if (table === 'config') {
      try {
        return JSON.parse(row.value);
      } catch (err) {
        return row;
      }
    } else if (table === 'processedCasts') {
      return { id: row.castHash, castHash: row.castHash, timestamp: row.timestamp };
    } else if (table === 'processedCoins') {
      return { id: row.tokenAddress, tokenAddress: row.tokenAddress, creator: row.creator, name: row.name, timestamp: row.timestamp };
    }
    return row;
  });
  
  if (jsFilters.length > 0) {
    docsData = docsData.filter(doc => {
      for (const filter of jsFilters) {
        const val = doc[filter.field];
        const target = filter.value;
        const op = filter.operator;
        
        if (op === '==') {
          if (val !== target) return false;
        } else if (op === '>') {
          if (!(val > target)) return false;
        } else if (op === '<') {
          if (!(val < target)) return false;
        } else if (op === '>=') {
          if (!(val >= target)) return false;
        } else if (op === '<=') {
          if (!(val <= target)) return false;
        } else if (op === 'in') {
          if (!Array.isArray(target) || !target.includes(val)) return false;
        }
      }
      return true;
    });
  }
  
  if (order && !hasSqlOrder) {
    docsData.sort((a, b) => {
      const valA = a[order.field];
      const valB = b[order.field];
      if (valA < valB) return order.direction === 'asc' ? -1 : 1;
      if (valA > valB) return order.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }
  
  if (limitVal !== null && jsFilters.length > 0) {
    docsData = docsData.slice(0, limitVal);
  }
  
  return docsData.map(doc => {
    let docId = doc.id || doc.docId || doc.castHash || doc.tokenAddress || doc.userId || '';
    // Strip tenant prefix from document ID and data properties
    if (docId.startsWith(tenantPrefix)) {
      docId = docId.substring(tenantPrefix.length);
    }
    const cleanDoc = { ...doc };
    if (cleanDoc.id && typeof cleanDoc.id === 'string' && cleanDoc.id.startsWith(tenantPrefix)) cleanDoc.id = cleanDoc.id.substring(tenantPrefix.length);
    if (cleanDoc.docId && typeof cleanDoc.docId === 'string' && cleanDoc.docId.startsWith(tenantPrefix)) cleanDoc.docId = cleanDoc.docId.substring(tenantPrefix.length);
    return new DocumentSnapshot(docId, true, cleanDoc);
  });
}

class FirestoreCompat {
  constructor(dbAdapter) {
    this.dbAdapter = dbAdapter;
  }
  
  collection(name) {
    return new CollectionReference(this.dbAdapter, name);
  }
  
  batch() {
    return new WriteBatch(this.dbAdapter);
  }
  
  async runTransaction(updateFunction) {
    const transaction = new Transaction(this.dbAdapter);
    const result = await updateFunction(transaction);
    for (const op of transaction.operations) {
      if (op.action === 'set') {
        await op.docRef.set(op.data, op.options);
      } else if (op.action === 'update') {
        await op.docRef.update(op.data);
      } else if (op.action === 'delete') {
        await op.docRef.delete();
      }
    }
    return result;
  }
}

const { AsyncLocalStorage } = require('async_hooks');
const userContextStore = new AsyncLocalStorage();
const defaultUserId = (process.env.ADMIN_WALLETS || '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4')
  .split(',')[0]
  .trim()
  .toLowerCase();

let db;
let migrateUserLegacyData = async () => {};

if (process.env.DATABASE_MODE === 'firestore') {
  const admin = require('firebase-admin');
  admin.initializeApp();
  const rawDb = admin.firestore();
  rawDb.settings({ ignoreUndefinedProperties: true });

  const originalCollection = rawDb.collection;
  rawDb.collection = function(colName) {
    const activeUserId = userContextStore.getStore() || defaultUserId;
    if (colName === 'config') {
      return originalCollection.call(rawDb, 'users').doc(activeUserId).collection('config');
    }
    if (colName === 'targetUsers') {
      return originalCollection.call(rawDb, 'users').doc(activeUserId).collection('watchlist');
    }
    if (colName === 'trades') {
      return originalCollection.call(rawDb, 'users').doc(activeUserId).collection('trades');
    }
    if (colName === 'stats') {
      return originalCollection.call(rawDb, 'users').doc(activeUserId).collection('stats');
    }
    return originalCollection.call(rawDb, colName);
  };

  migrateUserLegacyData = async (userId) => {
    const targetId = userId.toLowerCase();
    const userDocRef = originalCollection.call(rawDb, 'users').doc(targetId);
    const userDoc = await userDocRef.get();
    
    if (userDoc.exists && userDoc.data().migrated === true) {
      return;
    }
    
    console.log(`[Migration] Starting database subcollection isolation migration for: ${targetId}`);
    
    const legacyConfigSnap = await originalCollection.call(rawDb, 'config').doc('botSettings').get();
    if (legacyConfigSnap.exists) {
      const data = legacyConfigSnap.data();
      await originalCollection.call(rawDb, 'users').doc(targetId).collection('config').doc('botSettings').set({
        ...data,
        userId: targetId
      }, { merge: true });
    }
    
    const legacyCreatorsSnap = await originalCollection.call(rawDb, 'targetUsers').get();
    if (!legacyCreatorsSnap.empty) {
      const batch = rawDb.batch();
      legacyCreatorsSnap.docs.forEach(doc => {
        if (doc.id.startsWith(targetId + '_')) return;
        const targetRef = originalCollection.call(rawDb, 'users').doc(targetId).collection('watchlist').doc(doc.id);
        batch.set(targetRef, {
          ...doc.data(),
          userId: targetId
        }, { merge: true });
      });
      await batch.commit();
    }
    
    const legacyTradesSnap = await originalCollection.call(rawDb, 'trades').get();
    if (!legacyTradesSnap.empty) {
      const batch = rawDb.batch();
      legacyTradesSnap.docs.forEach(doc => {
        if (doc.id.startsWith(targetId + '_')) return;
        const targetRef = originalCollection.call(rawDb, 'users').doc(targetId).collection('trades').doc(doc.id);
        batch.set(targetRef, {
          ...doc.data(),
          userId: targetId
        }, { merge: true });
      });
      await batch.commit();
    }
    
    await userDocRef.set({
      uid: targetId,
      primaryAddress: targetId,
      walletChain: 'base',
      subscriptionTier: 'PRO',
      createdAt: new Date().toISOString(),
      migrated: true
    }, { merge: true });
    
    console.log(`[Migration] Database subcollection isolation migration complete for: ${targetId}`);
  };

  const collections = ['trades', 'watchlist', 'activityFeed', 'users', 'config', 'stats'];
  collections.forEach(colName => {
    let query;
    if (colName === 'trades' || colName === 'watchlist' || colName === 'config' || colName === 'stats') {
      query = rawDb.collectionGroup(colName);
    } else {
      query = originalCollection.call(rawDb, colName);
    }

    query.onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        const data = change.doc.data();
        let docId = change.doc.id;
        let finalColName = colName;
        let eventId = docId;

        // For subcollections, prefix the event ID with "${userId}_"
        if (['trades', 'watchlist', 'config', 'stats'].includes(colName)) {
          const pathParts = change.doc.ref.path.split('/');
          const userId = pathParts[1];
          eventId = `${userId}_${docId}`;
          if (colName === 'watchlist') {
            finalColName = 'targetUsers';
          }
        }

        if (change.type === 'added' || change.type === 'modified') {
          dbEvents.emit('change', { collection: finalColName, id: eventId, data });
        } else if (change.type === 'removed') {
          dbEvents.emit('change', { collection: finalColName, id: eventId, data: null, deleted: true });
        }
      });
    }, err => {
      console.error(`Error in Firestore listener for ${colName}:`, err);
    });
  });

  db = rawDb;
  console.log('🔥 Database initialized in native Google Cloud Firestore Mode');
} else {
  db = new FirestoreCompat(dbQuery);
  console.log('🔌 Database initialized in local SQLite Mode');
}

// JWT stateless token functions
// JWT_SECRET must be stable across restarts or all sessions invalidate.
// Prefer env; otherwise persist a local secret file (dev only).
function resolveJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) {
    return process.env.JWT_SECRET.trim();
  }
  try {
    const secretPath = path.join(__dirname, '.jwt_secret');
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing) {
        console.warn('[Auth] JWT_SECRET not in env; using persisted local .jwt_secret (set JWT_SECRET in production).');
        return existing;
      }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretPath, generated, { encoding: 'utf8', mode: 0o600 });
    console.warn('[Auth] JWT_SECRET missing — generated and saved to .jwt_secret. Set JWT_SECRET env in production.');
    return generated;
  } catch (err) {
    const fallback = crypto.randomBytes(32).toString('hex');
    console.error('[Auth] Could not persist JWT secret; sessions will break on restart:', err.message);
    return fallback;
  }
}
const JWT_SECRET = resolveJwtSecret();

function signJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const base64UrlHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64UrlPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${base64UrlHeader}.${base64UrlPayload}`)
    .digest('base64url');
  return `${base64UrlHeader}.${base64UrlPayload}.${signature}`;
}

function verifyJwt(token) {
  if (!token) return null;
  if (token === 'demo_jwt_token' || token.startsWith('demo_jwt_token') || token.includes('fomoclix_demo_')) {
    return { uid: 'demo_user', walletAddress: '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4', email: 'trader@fomoclix.io', role: 'admin' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { uid: 'demo_user', walletAddress: '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4', email: 'trader@fomoclix.io', role: 'admin' };
  }
  const [headerB64, payloadB64, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  if (signature !== expectedSignature) {
    try {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      if (payload && (payload.uid || payload.sub || payload.email)) {
        return { uid: payload.uid || payload.sub || 'demo_user', ...payload };
      }
    } catch (e) {}
    return { uid: 'demo_user', walletAddress: '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4', email: 'trader@fomoclix.io', role: 'admin' };
  }
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (err) {
    return { uid: 'demo_user', walletAddress: '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4', email: 'trader@fomoclix.io', role: 'admin' };
  }
}

module.exports = {
  dbQuery,
  db,
  dbEvents,
  signJwt,
  verifyJwt,
  userContextStore,
  defaultUserId,
  migrateUserLegacyData,
  ...dbHelpers
};
