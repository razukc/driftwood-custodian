const base = process.env.APP_URL ?? "http://127.0.0.1:3000";
// Default 40 req/s: comfortably inside a healthy pool (50 slots ≈ 600 req/s) but
// enough to swamp the bad deploy's single slot (~10-20 req/s) into 503s.
const rate = Number(process.argv.find((a) => a.startsWith("--rate="))?.split("=")[1] ?? 40);

const skus = Array.from({ length: 40 }, (_, i) => `SKU-${1000 + i}`);
const counts = {};

function render() {
  const line = Object.entries(counts).map(([k, v]) => `${k}×${v}`).join("  ");
  process.stdout.write(`\r${line}   `);
}

async function fire() {
  const isOrder = Math.random() < 0.15;
  const url = isOrder
    ? `${base}/api/orders`
    : `${base}/api/inventory/${skus[Math.floor(Math.random() * skus.length)]}`;
  const init = isOrder
    ? {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku: "SKU-1001", qty: 1 }),
      }
    : undefined;
  try {
    const res = await fetch(url, init);
    counts[res.status] = (counts[res.status] ?? 0) + 1;
  } catch {
    counts.ERR = (counts.ERR ?? 0) + 1;
  }
  render();
}

console.log(`sending ~${rate} req/s to ${base} (Ctrl-C to stop)`);
function loop() {
  fire();
  setTimeout(loop, (1000 / rate) * (0.5 + Math.random())); // jittered interval
}
loop();
