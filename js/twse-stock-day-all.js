function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseStockDayAllPayload(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const payload = JSON.parse(trimmed);
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length <= 1) return [];
  return lines.slice(1).map(parseCsvLine);
}

export function normalizeStockDayAllRow(row) {
  if (Array.isArray(row)) {
    const lead = String(row[0] ?? "").trim();
    // TWSE 陣列／CSV：0=日期, 1=代號, 2=名稱, 8=收盤價
    if (/^\d{6,7}$/.test(lead) && row.length >= 9) {
      return {
        code: String(row[1] ?? "").trim(),
        name: String(row[2] ?? "").trim(),
        closingPrice: row[8]
      };
    }
    return {
      code: String(row[0] ?? "").trim(),
      name: String(row[1] ?? "").trim(),
      closingPrice: row[7]
    };
  }

  return {
    code: String(row?.Code || row?.code || row?.Symbol || row?.symbol || "").trim(),
    name: String(row?.Name || row?.name || row?.NameZh || row?.nameZh || "").trim(),
    closingPrice: row?.ClosingPrice ?? row?.ClosePrice ?? row?.closingPrice ?? row?.closePrice ?? null
  };
}

export function toCloseNumber(value) {
  const raw = String(value ?? "").trim().replaceAll(",", "");
  if (!raw || raw === "-" || raw === "--") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function fetchStockDayAllRows(url, options = {}) {
  const { timeoutMs, ...rest } = options;
  const signal = rest.signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined);
  const res = await fetch(url, { ...rest, signal });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseStockDayAllPayload(text);
}
