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

export function createEmptyStock(symbol, name) {
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
