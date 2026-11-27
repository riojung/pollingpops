import {
  REPORT_HISTORY_ACTIVITY_BUCKET_LIMIT,
  type SurveyResultSummary,
  type SurveyResultsAnalytics,
  type SurveyResultsSources,
} from "@openround/contracts";
import type { Pool, QueryResultRow } from "pg";
import { countHistoryActivity } from "./report-history.js";
import type { SurveyRoom } from "./surveys.js";

type SurveyResultsCursor = Pick<SurveyResultSummary, "closesAt" | "id">;

export interface SurveyResultsFilters {
  now: Date;
  surveyId?: string;
  search?: string;
  from?: Date;
  to?: Date;
}

interface SurveyResultsListOptions extends SurveyResultsFilters {
  cursor?: SurveyResultsCursor;
  limit: number;
}

interface SurveyResultsHistoryPage {
  items: SurveyResultSummary[];
  next: SurveyResultsCursor | null;
}

export interface SurveyResultsHistoryRepository {
  list(workspaceId: string, options: SurveyResultsListOptions): Promise<SurveyResultsHistoryPage>;
  analytics(workspaceId: string, filters: SurveyResultsFilters): Promise<SurveyResultsAnalytics>;
  sources(workspaceId: string, now: Date): Promise<SurveyResultsSources>;
}

function newestDeadlineFirst(left: SurveyResultsCursor, right: SurveyResultsCursor) {
  return Date.parse(right.closesAt) - Date.parse(left.closesAt) || left.id.localeCompare(right.id);
}

function emptyAnalytics(): SurveyResultsAnalytics {
  return { rooms: 0, surveys: 0, activity: { month: [], quarter: [] }, refreshAfterMs: null };
}

function nextEligibilityChange({
  eligible,
  deadline,
  expiresAt,
}: {
  eligible: boolean;
  deadline: Date;
  expiresAt: Date;
}) {
  if (eligible) return expiresAt.getTime();
  return deadline < expiresAt ? deadline.getTime() : Infinity;
}

function refreshDelay(now: Date, nextChange: number) {
  return Number.isFinite(nextChange) ? nextChange - now.getTime() : null;
}

export class MemorySurveyResultsHistory implements SurveyResultsHistoryRepository {
  constructor(
    private readonly rooms: ReadonlyMap<string, SurveyRoom>,
    private readonly read: <T>(work: () => T) => Promise<T>,
  ) {}

  private *retainedRooms(workspaceId: string, now: Date) {
    for (const room of this.rooms.values()) {
      if (room.workspaceId !== workspaceId) continue;
      const expiresAt = new Date(room.expiresAt);
      if (expiresAt <= now) continue;
      const deadline = new Date(room.closesAt);
      yield { room, expiresAt, deadline, eligible: room.closed || deadline <= now };
    }
  }

  private matchingRetainedRooms(
    workspaceId: string,
    { now, from, to, search, surveyId }: SurveyResultsFilters,
  ) {
    const needle = search?.trim().toLowerCase();
    const source = surveyId?.toLowerCase();
    return [...this.retainedRooms(workspaceId, now)].filter(
      ({ room, deadline }) =>
        (!source || room.surveyId.toLowerCase() === source) &&
        (!from || deadline >= from) &&
        (!to || deadline <= to) &&
        (!needle ||
          room.content.title.toLowerCase().includes(needle) ||
          room.code.includes(needle)),
    );
  }

  list(workspaceId: string, options: SurveyResultsListOptions) {
    return this.read(() => {
      const { cursor, limit } = options;
      const page = this.matchingRetainedRooms(workspaceId, options)
        .filter(
          ({ room, eligible }) => eligible && (!cursor || newestDeadlineFirst(room, cursor) > 0),
        )
        .map(({ room }) => room)
        .sort(newestDeadlineFirst)
        .slice(0, limit + 1);
      const items = page
        .slice(0, limit)
        .map(({ id, surveyId, content, code, closesAt, expiresAt }) => ({
          id,
          surveyId,
          title: content.title,
          code,
          closesAt: new Date(closesAt).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
        }));
      const last = items.at(-1);
      const next = page.length > limit && last ? { closesAt: last.closesAt, id: last.id } : null;
      return { items, next };
    });
  }

  analytics(workspaceId: string, filters: SurveyResultsFilters) {
    return this.read(() => {
      const analytics = emptyAnalytics();
      const surveyIds = new Set<string>();
      let nextChange = Infinity;
      for (const match of this.matchingRetainedRooms(workspaceId, filters)) {
        nextChange = Math.min(nextChange, nextEligibilityChange(match));
        if (!match.eligible) continue;
        analytics.rooms += 1;
        surveyIds.add(match.room.surveyId);
        countHistoryActivity(analytics.activity, match.deadline);
      }
      analytics.surveys = surveyIds.size;
      analytics.refreshAfterMs = refreshDelay(filters.now, nextChange);
      return analytics;
    });
  }

  sources(workspaceId: string, now: Date) {
    return this.read(() => {
      const latestRoomBySurvey = new Map<string, SurveyRoom>();
      let nextChange = Infinity;
      for (const retained of this.retainedRooms(workspaceId, now)) {
        nextChange = Math.min(nextChange, nextEligibilityChange(retained));
        if (!retained.eligible) continue;
        const { room } = retained;
        const latest = latestRoomBySurvey.get(room.surveyId);
        if (!latest || newestDeadlineFirst(room, latest) < 0) {
          latestRoomBySurvey.set(room.surveyId, room);
        }
      }
      return {
        sources: [...latestRoomBySurvey.values()]
          .map(({ surveyId, content }) => ({ id: surveyId, title: content.title }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        refreshAfterMs: refreshDelay(now, nextChange),
      };
    });
  }
}

const RETAINED_SURVEY_RESULTS = `room.workspace_id = $1
  AND room.retention_expires_at > $2`;
const SURVEY_RESULTS_ELIGIBILITY = `(room.closes_at <= $2 OR room.data->>'closed' = 'true')`;
const SURVEY_RESULTS_TITLE = `room.data->'content'->>'title'`;
const SURVEY_RESULTS_WHERE = `WHERE ${RETAINED_SURVEY_RESULTS}
  AND ($3::uuid IS NULL OR room.survey_id = $3)
  AND ($4::timestamptz IS NULL OR room.closes_at >= $4)
  AND ($5::timestamptz IS NULL OR room.closes_at <= $5)
  AND ($6::text IS NULL OR strpos(
    lower((${SURVEY_RESULTS_TITLE}) COLLATE "und-x-icu"),
    lower($6::text COLLATE "und-x-icu")
  ) > 0 OR strpos(room.code, $6) > 0)`;
const SURVEY_RESULTS_REFRESH = `ceil(extract(epoch FROM min(CASE
    WHEN eligible THEN retention_expires_at
    WHEN closes_at < retention_expires_at THEN closes_at
  END) - $2::timestamptz) * 1000)::bigint`;

function surveyResultsParams(workspaceId: string, filters: SurveyResultsFilters) {
  return [
    workspaceId,
    filters.now,
    filters.surveyId ?? null,
    filters.from ?? null,
    filters.to ?? null,
    filters.search?.trim() || null,
  ];
}

export class PostgresSurveyResultsHistory implements SurveyResultsHistoryRepository {
  constructor(private readonly pool: Pool) {}

  private async query<Row extends QueryResultRow>(
    workspaceId: string,
    sql: string,
    params: unknown[],
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const { rows } = await client.query<Row>(sql, params);
      await client.query("COMMIT");
      return rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async list(workspaceId: string, options: SurveyResultsListOptions) {
    const rows = await this.query<{
      id: string;
      survey_id: string;
      title: string;
      code: string;
      closes_at: Date;
      retention_expires_at: Date;
      cursor_closes_at: string;
    }>(
      workspaceId,
      `SELECT room.id, room.survey_id, ${SURVEY_RESULTS_TITLE} AS title,
              room.code, room.closes_at, room.retention_expires_at,
              to_char(room.closes_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                AS cursor_closes_at
       FROM survey_feedback_rooms room
       ${SURVEY_RESULTS_WHERE}
         AND ${SURVEY_RESULTS_ELIGIBILITY}
         AND ($7::timestamptz IS NULL OR room.closes_at <= $7)
         AND ($7::timestamptz IS NULL OR room.closes_at <> $7 OR room.id > $8::uuid)
       ORDER BY room.closes_at DESC, room.id ASC
       LIMIT $9`,
      [
        ...surveyResultsParams(workspaceId, options),
        options.cursor?.closesAt ?? null,
        options.cursor?.id ?? null,
        options.limit + 1,
      ],
    );
    const items = rows.slice(0, options.limit).map((row) => ({
      id: row.id,
      surveyId: row.survey_id,
      title: row.title,
      code: row.code,
      closesAt: row.closes_at.toISOString(),
      expiresAt: row.retention_expires_at.toISOString(),
    }));
    const last = rows[items.length - 1];
    const next =
      rows.length > options.limit && last ? { closesAt: last.cursor_closes_at, id: last.id } : null;
    return { items, next };
  }

  async analytics(workspaceId: string, filters: SurveyResultsFilters) {
    const rows = await this.query<{
      period: "total" | "month" | "quarter";
      start: string | null;
      count: string;
      survey_count: string;
      refresh_after_ms: string | null;
    }>(
      workspaceId,
      `WITH matching AS (
         SELECT room.survey_id, room.closes_at, room.retention_expires_at,
                ${SURVEY_RESULTS_ELIGIBILITY} AS eligible
         FROM survey_feedback_rooms room
         ${SURVEY_RESULTS_WHERE}
       ), refresh AS (
         SELECT ${SURVEY_RESULTS_REFRESH} AS refresh_after_ms FROM matching
       ), periods AS (
         SELECT survey_id,
                date_trunc('month', closes_at AT TIME ZONE 'UTC') AS month_start,
                date_trunc('quarter', closes_at AT TIME ZONE 'UTC') AS quarter_start
         FROM matching WHERE eligible
       ), grouped AS (
         SELECT CASE
                  WHEN GROUPING(month_start) = 0 THEN 'month'
                  WHEN GROUPING(quarter_start) = 0 THEN 'quarter'
                  ELSE 'total'
                END AS period,
                coalesce(month_start, quarter_start) AS start,
                count(*) AS count,
                count(DISTINCT survey_id) AS survey_count
         FROM periods
         GROUP BY GROUPING SETS ((), (month_start), (quarter_start))
       ), ranked AS (
         SELECT *, row_number() OVER (PARTITION BY period ORDER BY start DESC) AS bucket_number
         FROM grouped
       )
       SELECT period, to_char(start, 'YYYY-MM-DD') AS start, count, survey_count, refresh_after_ms
       FROM ranked CROSS JOIN refresh
       WHERE bucket_number <= $7
       ORDER BY ranked.start ASC`,
      [...surveyResultsParams(workspaceId, filters), REPORT_HISTORY_ACTIVITY_BUCKET_LIMIT],
    );
    const analytics = emptyAnalytics();
    for (const row of rows) {
      if (row.period === "total") {
        analytics.rooms = Number(row.count);
        analytics.surveys = Number(row.survey_count);
        analytics.refreshAfterMs =
          row.refresh_after_ms === null ? null : Number(row.refresh_after_ms);
      } else if (row.start) {
        analytics.activity[row.period].push({ start: row.start, count: Number(row.count) });
      }
    }
    return analytics;
  }

  async sources(workspaceId: string, now: Date) {
    const rows = await this.query<{
      id: string | null;
      title: string | null;
      refresh_after_ms: string | null;
    }>(
      workspaceId,
      `WITH retained AS (
         SELECT room.id, room.survey_id, ${SURVEY_RESULTS_TITLE} AS title,
                room.closes_at, room.retention_expires_at, ${SURVEY_RESULTS_ELIGIBILITY} AS eligible
         FROM survey_feedback_rooms room
         WHERE ${RETAINED_SURVEY_RESULTS}
       ), refresh AS (
         SELECT ${SURVEY_RESULTS_REFRESH} AS refresh_after_ms FROM retained
       ), sources AS (
         SELECT DISTINCT ON (survey_id) survey_id AS id, title
         FROM retained
         WHERE eligible
         ORDER BY survey_id, closes_at DESC, retained.id ASC
       )
       SELECT sources.id, sources.title, refresh.refresh_after_ms
       FROM refresh LEFT JOIN sources ON true
       ORDER BY sources.id`,
      [workspaceId, now],
    );
    const refreshAfterMs = rows[0]?.refresh_after_ms;
    return {
      sources: rows.flatMap(({ id, title }) => (id && title !== null ? [{ id, title }] : [])),
      refreshAfterMs: refreshAfterMs == null ? null : Number(refreshAfterMs),
    };
  }
}
