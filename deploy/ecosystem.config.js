// pm2 config for the live server (alternative to the systemd service from setup-vps.sh):
//   sudo pm2 start /opt/clientinvoice/deploy/ecosystem.config.js && sudo pm2 save
// Settings come from /opt/clientinvoice/server/.env (loaded by the app itself).
module.exports = {
  apps: [
    {
      name: 'clientinvoice',
      cwd: '/opt/clientinvoice/server',
      // Launch Node 24 directly (the app needs 24+; pm2 itself may run on another Node). Going through
      // pm2's own wrapper would fail because the app user cannot read pm2's install under /root.
      script: '/opt/node24/bin/node',
      args: 'src/index.js',
      interpreter: 'none',
      uid: 'clientinvoice',
      gid: 'clientinvoice',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
