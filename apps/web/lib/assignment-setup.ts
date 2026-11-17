/** Validate browser-local schedule fields before sending the existing assignment request. */
export function assignmentScheduleError(
  {
    opensLater,
    opensAt,
    closesAt,
    maxClosesAt,
  }: {
    opensLater: boolean;
    opensAt: string;
    closesAt: string;
    maxClosesAt: string;
  },
  now = new Date(),
): "invalid" | "past" | "order" | "retention" | null {
  const opening = opensLater ? new Date(opensAt) : now;
  const closing = new Date(closesAt);
  if (!Number.isFinite(opening.getTime()) || !Number.isFinite(closing.getTime())) return "invalid";
  if (closing <= now) return "past";
  if (closing <= opening) return "order";
  if (maxClosesAt && closing > new Date(maxClosesAt)) return "retention";
  return null;
}

export function duplicatePersonalLabelCount(value: string, uniqueCount: number) {
  return value.split(/\r?\n/).filter((line) => line.trim()).length - uniqueCount;
}
