import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";
const config = loadConfig();
const app = await buildApp(config);
try { await app.listen({ host: config.HOST, port: config.PORT }); }
catch (error) { app.log.fatal(error); process.exit(1); }
