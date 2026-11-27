export function libraryDateRangeFilter({ from, to }: { from?: string; to?: string }) {
  if (!from && !to) return () => true;

  const start = from ? Date.parse(from) : -Infinity;
  const end = to ? Date.parse(to) : Infinity;
  return (timestamp: string) => {
    const time = Date.parse(timestamp);
    return time >= start && time <= end;
  };
}
