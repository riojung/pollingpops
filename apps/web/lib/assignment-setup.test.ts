import { describe, expect, it } from "vitest";
import { assignmentScheduleError, duplicatePersonalLabelCount } from "./assignment-setup";
import { localDateTimeValue } from "./practice-assignment";

describe("assignment setup schedule", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const at = (hours: number) => localDateTimeValue(new Date(now.getTime() + hours * 3_600_000));
  const base = { opensLater: false, opensAt: at(2), closesAt: at(24), maxClosesAt: at(48) };
  it("requires a valid future close even when opening immediately", () => {
    expect(assignmentScheduleError({ ...base, closesAt: "" }, now)).toBe("invalid");
    expect(assignmentScheduleError({ ...base, closesAt: at(-1) }, now)).toBe("past");
    expect(assignmentScheduleError(base, now)).toBeNull();
  });
  it("respects the opening and retention boundaries without timezone conversion errors", () => {
    expect(assignmentScheduleError({ ...base, opensLater: true, opensAt: at(24) }, now)).toBe(
      "order",
    );
    expect(assignmentScheduleError({ ...base, closesAt: at(49) }, now)).toBe("retention");
    expect(assignmentScheduleError({ ...base, closesAt: at(48) }, now)).toBeNull();
    expect(assignmentScheduleError({ ...base, opensLater: true, opensAt: "" }, now)).toBe(
      "invalid",
    );
  });
  it("explains removed duplicate lines without counting blanks", () => {
    expect(duplicatePersonalLabelCount(" Ada\n\nLin\nada \n", 2)).toBe(1);
    expect(duplicatePersonalLabelCount("\n", 0)).toBe(0);
  });
});
