import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const TWSE_ENDPOINT = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const OUTPUT = resolve(process.cwd(), "data/stock-master.json");

function toSymbol(code) {
  const c = String(code || "").trim();
  return c ? `${c}.TW` : "";
}

function buildMaster(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const code = row.Code || row.code;
    const name = row.Name || row.name || "";
    const symbol = toSymbol(code);
    if (!symbol || !name) continue;
    const closing = row.ClosingPrice ?? row.ClosePrice ?? null;
    const lastClose = closing == null || closing === "" ? null : Number(closing);
    map.set(symbol, {
      symbol,
      name: String(name).trim(),
      lastClose: Number.isFinite(lastClose) ? lastClose : null
    });
  }
  return Array.from(map.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function main() {
  const res = await fetch(TWSE_ENDPOINT);
  if (!res.ok) {
    throw new Error(`Fetch failed: HTTP ${res.status}`);
  }
  const rows = await res.json();
  const items = buildMaster(rows);
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  console.log(`Updated ${items.length} symbols -> ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

