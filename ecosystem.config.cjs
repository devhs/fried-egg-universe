// PM2 설정. 사용: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'fried-egg',
    script: 'server.js',
    instances: 1,            // SQLite는 단일 프로세스 권장 (cluster 모드 X)
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DB_PATH: '/var/lib/fried-egg/fried-egg.db',
      DRAW_COST: 50,
    },
    max_memory_restart: '300M',
    out_file: '/var/log/fried-egg/out.log',
    error_file: '/var/log/fried-egg/err.log',
  }],
};
