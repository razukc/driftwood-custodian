import { createApp } from "./server.js";
import { config } from "./config.js";

const port = Number(process.env.PORT ?? 3000);
// Bind localhost by default (the app is the monitored fiction, not internet-facing);
// Cloud Run sets HOST=0.0.0.0 so the platform can route to it.
const host = process.env.HOST ?? "127.0.0.1";
createApp().listen(port, host, () => {
  console.log(`driftwood-inventory ${config.version} listening on http://${host}:${port}`);
});
