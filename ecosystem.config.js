module.exports = {
  apps: [
    {
      name: 'reparations-server',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://reparations_user:hjEMn35Kw7p712q1SYJnBxZqIYRdahHv@dpg-d3v78f7diees73epc4k0-a.oregon-postgres.render.com/reparations?sslmode=require'
      },
      env_production: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://reparations_user:hjEMn35Kw7p712q1SYJnBxZqIYRdahHv@dpg-d3v78f7diees73epc4k0-a.oregon-postgres.render.com/reparations?sslmode=require'
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_file: 'logs/pm2-combined.log',
      time: true
    }
  ]
};
