import { createApp } from "./server.js";
import { config } from "./config.js";

const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, "127.0.0.1", () => {
  console.log(`driftwood-inventory ${config.version} listening on http://127.0.0.1:${port}`);
});
