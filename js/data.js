export const stockDataset = [
  {
    symbol: "2330.TW",
    name: "台積電",
    currentPrice: 1120,
    nextDividendDate: "2026/03/19",
    cashDividend: 4.5,
    nextRightsDate: "2026/03/19",
    stockDividend: 0.1,
    referencePrice: 1114.5,
    spreadRatio: 12.5,
    history: [
      {
        date: "2026/03/19",
        cash: 4.5,
        currentPrice: 1120,
        referencePrice: 1114.5,
        ratio: 12.5
      },
      {
        date: "2025/12/18",
        cash: 4.0,
        currentPrice: 1050,
        referencePrice: 1012.5,
        ratio: 6.7
      },
      {
        date: "2025/09/12",
        cash: 4.0,
        currentPrice: 940,
        referencePrice: 901.2,
        ratio: 19.1
      }
    ]
  },
  {
    symbol: "2334.TW",
    name: "聯詠",
    currentPrice: 580,
    nextDividendDate: "還未公佈",
    cashDividend: null,
    nextRightsDate: "還未公佈",
    stockDividend: null,
    referencePrice: null,
    spreadRatio: null,
    history: []
  },
  {
    symbol: "2884.TW",
    name: "玉山金",
    currentPrice: 31.7,
    nextDividendDate: "2026/03/19",
    cashDividend: 1.2,
    nextRightsDate: "2026/03/19",
    stockDividend: 0.1,
    referencePrice: 30.6,
    spreadRatio: 3.4,
    history: [
      {
        date: "2026/03/19",
        cash: 1.2,
        currentPrice: 31.7,
        referencePrice: 30.6,
        ratio: 3.4
      }
    ]
  },
  {
    symbol: "2888.TW",
    name: "新光金",
    currentPrice: 9.8,
    nextDividendDate: "2026/03/19",
    cashDividend: 0.8,
    nextRightsDate: "2026/03/19",
    stockDividend: 0.1,
    referencePrice: 9.3,
    spreadRatio: 7.9,
    history: [
      {
        date: "2026/03/19",
        cash: 0.8,
        currentPrice: 9.8,
        referencePrice: 9.3,
        ratio: 7.9
      }
    ]
  }
];

export function getSignalByRatio(spreadRatio) {
  if (spreadRatio == null) {
    return { key: "white", icon: "⚪", text: "白燈（待定）" };
  }
  if (spreadRatio < 5) {
    return { key: "white", icon: "⚪", text: "白燈（常態區間）" };
  }
  if (spreadRatio < 10) {
    return { key: "green", icon: "🟢", text: "綠燈（初步獲利區）" };
  }
  if (spreadRatio < 15) {
    return { key: "yellow", icon: "🟡", text: "黃燈（高價值區）" };
  }
  return { key: "red", icon: "🔴", text: "紅燈（超額利潤區）" };
}

export function formatMoney(v) {
  if (v == null) {
    return "--";
  }
  return `NT$${Number(v).toLocaleString("zh-TW")}`;
}

export function cloneStock(item) {
  return {
    ...item,
    history: (item.history || []).map((h) => ({ ...h }))
  };
}

export function createCustomStock(symbol, name) {
  return {
    symbol,
    name,
    currentPrice: null,
    nextDividendDate: "還未公佈",
    cashDividend: null,
    nextRightsDate: "還未公佈",
    stockDividend: null,
    referencePrice: null,
    spreadRatio: null,
    history: []
  };
}
