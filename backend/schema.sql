-- Cloudflare D1 / SQLite Database Schema for Zora Bot

-- Config table (stores config/botSettings documents)
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Trades table (active and historical positions)
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  tokenAddress TEXT,
  status TEXT,
  boughtAt INTEGER,
  soldAt INTEGER,
  creatorAddress TEXT,
  data TEXT
);

CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_boughtAt ON trades(boughtAt);
CREATE INDEX IF NOT EXISTS idx_trades_tokenAddress ON trades(tokenAddress);

-- Activity Feed table
CREATE TABLE IF NOT EXISTS activityFeed (
  id TEXT PRIMARY KEY,
  type TEXT,
  timestamp INTEGER,
  isTarget INTEGER DEFAULT 0,
  coinType TEXT,
  data TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activityFeed(timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activityFeed(type);

-- Target Users (Tracked Creators)
CREATE TABLE IF NOT EXISTS targetUsers (
  userId TEXT PRIMARY KEY,
  fid TEXT,
  status TEXT,
  addedAt TEXT,
  data TEXT
);

CREATE INDEX IF NOT EXISTS idx_target_status ON targetUsers(status);

-- Processed Casts (deduplication)
CREATE TABLE IF NOT EXISTS processedCasts (
  castHash TEXT PRIMARY KEY,
  timestamp INTEGER
);

-- Processed Coins (deduplication)
CREATE TABLE IF NOT EXISTS processedCoins (
  tokenAddress TEXT PRIMARY KEY,
  creator TEXT,
  name TEXT,
  timestamp INTEGER
);

-- Users (stores user settings, spend permissions, 2FA, etc.)
CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  data TEXT
);
