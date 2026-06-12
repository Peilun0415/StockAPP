// 產出「個股篩選」頁所需的靜態資料 data/screener.json。
// 抓取與計算邏輯移植自桌面版 MiniStocker（code/main.js + code/web/index.js）：
//   - TWSE/TPEX OpenAPI：月營收、綜合損益表、股價（瀏覽器有 CORS 限制，故改由此腳本預先抓取）
//   - MOPS：前三季累計 EPS（POST redirectToOld 後解析 HTML 表格），換算成單季 EPS
// 由 GitHub Actions 排程執行後 commit，前端直接讀取 JSON。

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TWSE_BASE = "https://openapi.twse.com.tw/v1";
const TPEX_BASE = "https://www.tpex.org.tw/openapi/v1";
const MOPS_REDIRECT_URL = "https://mops.twse.com.tw/mops/api/redirectToOld";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

const OUTPUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "screener.json"
);

const FETCH_TIMEOUT_MS = 180_000;
const FETCH_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, { retries = FETCH_RETRIES } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (!res.ok) {
        throw new Error(`GET ${url} failed: HTTP ${res.status}`);
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        console.warn(`[retry ${attempt}/${retries}] ${url}: ${error.message}`);
        await sleep(3000 * attempt);
      }
    }
  }
  throw lastError;
}

async function fetchJsonSequential(urls, label = "") {
  const results = [];
  for (const url of urls) {
    if (label) console.log(`[${label}] GET ${url.split("/").pop()}`);
    results.push(await fetchJson(url));
  }
  return results;
}

// 多個 API 對同一欄位的命名不一致（TPEX 部分欄位用英文），統一用候選 key 取值
function pick(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

// ==================== 上市（TWSE） ====================
async function fetchTwseData() {
  const incomeSuffixes = ["ci", "fh", "ins", "mim", "basi"];
  const [monthlyRevenueSummary, exchangeReport, ...incomeParts] = await Promise.all([
    fetchJson(`${TWSE_BASE}/opendata/t187ap05_L`),
    fetchJson(`${TWSE_BASE}/exchangeReport/TWT84U`),
    ...incomeSuffixes.map((s) => fetchJson(`${TWSE_BASE}/opendata/t187ap06_L_${s}`))
  ]);
  return {
    monthlyRevenueSummary,
    incomeStatement: incomeParts.flat(),
    exchangeReport
  };
}

// ==================== 上櫃（TPEX） ====================
async function fetchTpexData() {
  const incomeSuffixes = ["ci", "fh", "ins", "mim", "basi"];
  // TPEX 回應較慢，改逐支抓取避免並行請求逾時
  const [monthlyRevenueSummary, exchangeReportRaw, ...incomeParts] = await fetchJsonSequential([
    `${TPEX_BASE}/mopsfin_t187ap05_O`,
    `${TPEX_BASE}/tpex_odd_stock`,
    ...incomeSuffixes.map((s) => `${TPEX_BASE}/mopsfin_t187ap06_O_${s}`)
  ], "otc");

  const incomeStatement = incomeParts.flat().map((item) => ({
    ...item,
    "公司名稱": pick(item, ["公司名稱", "CompanyName"]),
    "公司代號": pick(item, ["公司代號", "SecuritiesCompanyCode"]),
    "季別": pick(item, ["季別", "Season"]),
    "年度": pick(item, ["年度", "Year"])
  }));

  const exchangeReport = exchangeReportRaw.map((item) => {
    let price = Number(item["Price"]);
    if (price === 0) {
      // 尚未成交，用買賣掛單中間價估算
      price = (Number(item["LastBestBidPrice"]) + Number(item["LastBestAskPrice"])) / 2;
    }
    return {
      ...item,
      TodayOpeningRefPrice: price.toFixed(2),
      Name: item["CompanyName"],
      Code: item["SecuritiesCompanyCode"]
    };
  });

  return { monthlyRevenueSummary, incomeStatement, exchangeReport };
}

// ==================== MOPS 累計 EPS ====================
function parseTableToMap(html) {
  const trRegex = /<tr>([\s\S]*?)<\/tr>/g;
  const tdRegex = /<td[^>]*>(.*?)<\/td>/g;
  const dataMap = new Map();

  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[1];
    const tds = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      tds.push(tdMatch[1].trim().replace(/\s+/g, " "));
    }
    if (tds.length >= 4) {
      // 第一個 td → 股票代號；第四個 td → 累計 EPS
      dataMap.set(tds[0], tds[3]);
    }
  }
  return dataMap;
}

async function fetchEpsMap(rocYear, season, type) {
  const payload = {
    apiName: "ajax_t163sb19",
    parameters: {
      year: String(rocYear),
      TYPEK: type,
      code: "",
      season: `0${season}`,
      encodeURIComponent: 1,
      step: 1,
      firstin: 1,
      off: 1
    }
  };

  const res1 = await fetch(MOPS_REDIRECT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res1.ok) {
    throw new Error(`MOPS redirectToOld failed: HTTP ${res1.status}`);
  }
  const redirectUrl = (await res1.json())?.result?.url;
  if (!redirectUrl) {
    throw new Error(`MOPS redirectToOld（year=${rocYear} season=${season} type=${type}）未回傳 URL`);
  }

  const res2 = await fetch(redirectUrl, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res2.ok) {
    throw new Error(`MOPS data fetch failed: HTTP ${res2.status}`);
  }
  return parseTableToMap(await res2.text());
}

function getPrevSeason(season, year, offset = 1) {
  let newSeason = season - offset;
  let newYear = year;
  while (newSeason <= 0) {
    newSeason += 4;
    newYear -= 1;
  }
  return { season: newSeason, year: newYear };
}

// 取得「單季 EPS」：當季累計 - 上季累計（第一季直接用累計值）
async function getSingleSeasonEps(season, year, type) {
  const sumEpsMap = await fetchEpsMap(year, season, type);
  if (season === 1) {
    return { singleEpsMap: sumEpsMap, sumEpsMap };
  }
  const { season: prevSeason, year: prevYear } = getPrevSeason(season, year, 1);
  const prevEpsMap = await fetchEpsMap(prevYear, prevSeason, type);

  const singleEpsMap = new Map();
  for (const [code, eps] of sumEpsMap.entries()) {
    const prevEps = Number(prevEpsMap.get(code)) || 0;
    singleEpsMap.set(code, (Number(eps) - prevEps).toFixed(2));
  }
  return { singleEpsMap, sumEpsMap };
}

async function getEpsData(type, incomeStatement) {
  const currentSeason = Number(incomeStatement[0]["季別"]);
  const currentYear = Number(incomeStatement[0]["年度"]);

  const q1 = getPrevSeason(currentSeason, currentYear, 1);
  const q2 = getPrevSeason(currentSeason, currentYear, 2);
  const q3 = getPrevSeason(currentSeason, currentYear, 3);

  const { singleEpsMap: last1Map, sumEpsMap: last1SumMap } = await getSingleSeasonEps(q1.season, q1.year, type);
  const { singleEpsMap: last2Map } = await getSingleSeasonEps(q2.season, q2.year, type);
  const { singleEpsMap: last3Map } = await getSingleSeasonEps(q3.season, q3.year, type);

  return {
    quarters: {
      current: { year: currentYear, season: currentSeason },
      prev: [q1, q2, q3]
    },
    last1Map,
    last2Map,
    last3Map,
    last1SumMap
  };
}

// ==================== 合併輸出列 ====================
function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildRows(data, epsData) {
  const { monthlyRevenueSummary, incomeStatement, exchangeReport } = data;
  const { last1Map, last2Map, last3Map, last1SumMap } = epsData;

  const incomeByCode = new Map(incomeStatement.map((i) => [String(i["公司代號"]), i]));
  const priceByCode = new Map(exchangeReport.map((e) => [String(e["Code"]), e]));

  const rows = [];
  for (const m of monthlyRevenueSummary) {
    const code = String(m["公司代號"] || "").trim();
    if (!code) continue;
    const i = incomeByCode.get(code);
    if (!i) continue;

    const currentSumEps = Number(pick(i, ["基本每股盈餘（元）", "BasicEarningsPerShare"]));
    const lastEps = Number(last1Map.get(code));
    const lastSumEps = Number(last1SumMap.get(code));

    // 與桌面版相同：上季單季 EPS 不存在或為 0 時無法計算成長率，直接排除
    if (Number.isNaN(lastEps) || lastEps === 0) continue;
    const epsGrowth = ((currentSumEps - lastSumEps - lastEps) / Math.abs(lastEps)) * 100;

    const e = priceByCode.get(code);
    rows.push({
      code,
      name: m["公司名稱"] ?? code,
      industry: m["產業別"] ?? "",
      price: toNumberOrNull(e?.["TodayOpeningRefPrice"]),
      monthGrowth: toNumberOrNull(m["營業收入-去年同月增減(%)"]),
      yearGrowth: toNumberOrNull(m["累計營業收入-前期比較增減(%)"]),
      grossProfit: pick(i, ["營業毛利（毛損）", "GrossProfitLoss", "GrossProfit"]),
      epsGrowth: Number(epsGrowth.toFixed(2)),
      epsCurrent: Number((currentSumEps - (Number.isFinite(lastSumEps) ? lastSumEps : 0)).toFixed(2)),
      eps1: last1Map.get(code) ?? null,
      eps2: last2Map.get(code) ?? null,
      eps3: last3Map.get(code) ?? null,
      operatingIncome: pick(i, ["營業利益（損失）", "OperatingIncomeLoss", "OperatingProfitLoss"]),
      netIncome: pick(i, ["淨利（淨損）歸屬於母公司業主", "ProfitLossAttributableToOwnersOfParent"]),
      note: m["備註"] ?? ""
    });
  }
  return rows;
}

async function buildMarket(type, fetchData) {
  console.log(`[${type}] 抓取 OpenAPI 資料...`);
  const data = await fetchData();
  console.log(`[${type}] 月營收 ${data.monthlyRevenueSummary.length} 筆、損益表 ${data.incomeStatement.length} 筆、股價 ${data.exchangeReport.length} 筆`);

  console.log(`[${type}] 抓取 MOPS EPS...`);
  const epsData = await getEpsData(type, data.incomeStatement);
  console.log(`[${type}] EPS maps：上季 ${epsData.last1Map.size}、上上季 ${epsData.last2Map.size}、上上上季 ${epsData.last3Map.size}`);

  const rows = buildRows(data, epsData);
  console.log(`[${type}] 合併輸出 ${rows.length} 筆`);

  return {
    dataMonth: data.monthlyRevenueSummary[0]?.["資料年月"] ?? "",
    quarters: epsData.quarters,
    rows
  };
}

async function main() {
  const sii = await buildMarket("sii", fetchTwseData);
  const otc = await buildMarket("otc", fetchTpexData);

  const output = {
    generatedAt: new Date().toISOString(),
    sii,
    otc
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output), "utf8");
  console.log(`已寫入 ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error("build-screener-data 失敗：", error);
  process.exitCode = 1;
});
