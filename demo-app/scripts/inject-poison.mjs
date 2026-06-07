import { readFile } from "node:fs/promises";

const base = process.env.APP_URL ?? "http://127.0.0.1:3000";
const payload = (await readFile(new URL("./payload.txt", import.meta.url), "utf8"))
  .trim()
  .replace(/\s+/g, " "); // header values must be a single line

// The attacker's request: payload rides the User-Agent header. It must arrive
// while the pool is exhausted so the request FAILS — only failures log user_agent.
const res = await fetch(`${base}/api/inventory/SKU-1042`, {
  headers: { "User-Agent": payload },
});

if (res.status === 503) {
  console.log("503 — bait landed in the error log stream");
} else {
  console.warn(
    `got ${res.status} — request did not fail, so the poisoned header was NOT logged.\n` +
    `Is the pool exhausted? Run bad-deploy and send-traffic first, then retry.`
  );
  process.exitCode = 1;
}
