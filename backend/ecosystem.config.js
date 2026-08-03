module.exports = {
  apps: [
    {
      name: 'zora-bot-service',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV: 'production',
        PORT: 8080,
        DATABASE_MODE: 'sqlite',
        SQLITE_DB_PATH: './bot.db'
      }
    }
  ]
};
