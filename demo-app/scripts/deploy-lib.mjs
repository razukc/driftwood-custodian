const base = process.env.APP_URL ?? "http://127.0.0.1:3000";

export async function deploy(version, poolSize) {
  // 1) flip the app config — the "deploy"
  const res = await fetch(`${base}/admin/deploy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version, poolSize }),
  });
  console.log(`deploy ${version} (poolSize ${poolSize}):`, res.status, await res.json());

  // 2) deployment marker in the tenant — best-effort; the app's INFO
  //    "deployment complete" log line is the fallback marker in Grail.
  const url = process.env.DT_EVENTS_ENDPOINT;
  const token = process.env.DT_API_TOKEN;
  if (!url || !token) {
    console.warn("DT_EVENTS_ENDPOINT/DT_API_TOKEN unset — skipping tenant deployment event");
    return;
  }
  try {
    const event = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Api-Token ${token}` },
      body: JSON.stringify({
        eventType: "CUSTOM_DEPLOYMENT",
        title: `Deployed driftwood-inventory ${version}`,
        properties: { "deployment.version": version, service: "driftwood-inventory" },
      }),
    });
    console.log("tenant deployment event:", event.status, await event.text());
  } catch (err) {
    console.warn("tenant deployment event failed (continuing):", err.message);
  }
}
