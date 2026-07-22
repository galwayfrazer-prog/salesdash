export function filterDealsForPeriod(deals, period, now = new Date()) {
  const nowTime = now.getTime();
  const quarter = Math.floor(now.getMonth() / 3);
  const start = new Date(now.getFullYear(), quarter * 3, 1).getTime();
  const end = new Date(now.getFullYear(), quarter * 3 + 3, 1).getTime();

  return deals.filter((deal) => {
    const rawDate = deal.Closing_Date || deal.Created_Time;
    const timestamp = rawDate ? new Date(rawDate).getTime() : Number.NaN;
    if (!Number.isFinite(timestamp) || timestamp > nowTime) return false;
    if (period === "all") return true;
    return timestamp >= start && timestamp < end;
  });
}
