module.exports = {
  apps: [{
    name: 'trading-signal-bot',
    script: './src/index.js',
    interpreter: 'node',

    // Runtime configuration
    instances: 1,
    exec_mode: 'fork',

    // Auto-restart configuration
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',

    // Restart delay
    restart_delay: 5000,

    // Max restart attempts
    max_restarts: 10,
    min_uptime: '10s',

    // Environment variables (loaded from .env file)
    env: {
      NODE_ENV: 'production',
    },

    // Logging
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_file: './logs/combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

    // Merge logs from all instances
    merge_logs: true,

    // Advanced features
    kill_timeout: 5000,
    listen_timeout: 10000,
    shutdown_with_message: true,

    // Cron restart (optional - restart daily at 00:00 UTC)
    // cron_restart: '0 0 * * *',

    // Source map support
    source_map_support: true,

    // Instance variables
    instance_var: 'INSTANCE_ID',
  }]
};
