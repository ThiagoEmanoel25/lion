// PM2: pm2 start ecosystem.config.cjs --env production
// Execute a partir da raiz do repositório (o .env é lido de ./.env).
const common = {
  cwd: __dirname,
  exec_mode: 'fork', // runtime Baileys: manter 1 instância (sessões WhatsApp com lock)
  instances: 1,
  autorestart: true,
  max_restarts: 10,
  min_uptime: '10s',
  kill_timeout: 15000, // dá tempo ao shutdown gracioso
  merge_logs: true,
  out_file: 'logs/out.log',
  error_file: 'logs/err.log',
  env: { NODE_ENV: 'production' },
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'nexo-api',
      script: 'apps/api/dist/apps/api/src/server.js',
      max_memory_restart: '512M',
    },
    {
      ...common,
      name: 'nexo-runtime',
      script: 'apps/runtime/dist/apps/runtime/src/main.js',
      max_memory_restart: '768M',
    },
  ],
};
