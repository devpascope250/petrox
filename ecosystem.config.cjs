/**
 * pm2 process for the API on the server (CloudPanel site api.ikwim.com).
 * nginx forwards https://api.ikwim.com to 127.0.0.1:<App Port>, so PORT in the
 * server's .env must equal the App Port set for the site in CloudPanel.
 *
 * One instance: the rate limits and the sweep that cancels overdue POS sales
 * live in the process.
 */
module.exports = {
  apps: [
    {
      name: "ikwim-api",
      cwd: __dirname,
      script: "dist/src/server.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      time: true,
      env_production: { NODE_ENV: "production" },
    },
  ],
};
