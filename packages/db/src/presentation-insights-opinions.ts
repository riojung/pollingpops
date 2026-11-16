import { ScopedQnaReceiptSchema } from "@openround/contracts";
import type {
  PresentationSessionRecord,
  PresentationSessionResponseRecord,
} from "./presentation-session-types.js";
import type { PostgresRepository } from "./postgres.js";
export interface PresentationInsightsOpinionSelector {
  blockId: string;
  questionId: string;
  type: "poll" | "rating";
  choiceIds: string[];
  min: number | null;
  max: number | null;
  semanticIds: boolean;
}
export interface PresentationInsightsOpinionCount {
  blockId: string;
  responseCount: number;
  buckets: { key: string; count: number }[];
}
export function validateInsightsOpinionSelectors(selectors: PresentationInsightsOpinionSelector[]) {
  if (!Array.isArray(selectors) || selectors.length > 200)
    throw new Error("Choose at most 200 opinion selectors");
  for (const value of selectors) {
    ScopedQnaReceiptSchema.shape.resourceId.parse(value.blockId);
    ScopedQnaReceiptSchema.shape.resourceId.parse(value.questionId);
    if (
      typeof value.semanticIds !== "boolean" ||
      !Array.isArray(value.choiceIds) ||
      value.choiceIds.length > 100
    )
      throw new Error("Invalid opinion selector");
    if (value.type === "poll") {
      if (
        !value.choiceIds.length ||
        new Set(value.choiceIds).size !== value.choiceIds.length ||
        value.min !== null ||
        value.max !== null
      )
        throw new Error("Invalid poll selector");
      for (const id of value.choiceIds) ScopedQnaReceiptSchema.shape.resourceId.parse(id);
    } else if (
      value.type !== "rating" ||
      value.choiceIds.length ||
      !Number.isSafeInteger(value.min) ||
      !Number.isSafeInteger(value.max) ||
      value.min! < 1 ||
      value.max! > 100 ||
      value.max! < value.min! ||
      value.max! - value.min! >= 100
    )
      throw new Error("Invalid rating selector");
  }
  if (new Set(selectors.map((row) => row.blockId.toLowerCase())).size !== selectors.length)
    throw new Error("Duplicate opinion selector");
  return selectors;
}
export function opinionSelectorMatches(
  session: PresentationSessionRecord,
  selector: PresentationInsightsOpinionSelector,
) {
  const same = (left: string, right: string) =>
    selector.semanticIds ? left.toLowerCase() === right.toLowerCase() : left === right;
  if (selector.semanticIds !== session.content.schemaVersion >= 12) return false;
  const block = session.content.blocks.find((block) => same(block.id, selector.blockId));
  if (
    block?.kind !== "question" ||
    !same(block.question.id, selector.questionId) ||
    block.question.type !== selector.type
  )
    return false;
  const question = block.question;
  return question.type === "poll"
    ? (question.maxSelections ?? 1) === 1 &&
        JSON.stringify(question.choices.map((row) => row.id)) === JSON.stringify(selector.choiceIds)
    : question.type === "rating" && question.min === selector.min && question.max === selector.max;
}
export function memoryInsightsOpinionCounts(
  session: PresentationSessionRecord,
  selectors: PresentationInsightsOpinionSelector[],
  responses: Iterable<PresentationSessionResponseRecord>,
): PresentationInsightsOpinionCount[] {
  const result: PresentationInsightsOpinionCount[] = [],
    rows = Array.from(responses);
  for (const selector of selectors) {
    if (!opinionSelectorMatches(session, selector)) continue;
    const same = (left: string, right: string) =>
      selector.semanticIds ? left.toLowerCase() === right.toLowerCase() : left === right;
    const buckets = (
      selector.type === "poll"
        ? selector.choiceIds
        : Array.from({ length: selector.max! - selector.min! + 1 }, (_, index) =>
            String(selector.min! + index),
          )
    ).map((key) => ({ key, count: 0 }));
    let responseCount = 0;
    for (const row of rows) {
      if (
        row.workspaceId !== session.workspaceId ||
        row.sessionId !== session.id ||
        !same(row.blockId, selector.blockId) ||
        !same(row.questionId, selector.questionId) ||
        ![1, 2].includes(row.responseSchemaVersion ?? 1)
      )
        continue;
      responseCount++;
      const value = row.response;
      let key: string | undefined;
      if (
        selector.type === "poll" &&
        value.choiceIds?.length === 1 &&
        value.orderedChoiceIds === undefined &&
        value.ratingValue === undefined &&
        value.numericValue === undefined &&
        value.textValue === undefined
      )
        key = value.choiceIds[0];
      if (
        selector.type === "rating" &&
        Number.isInteger(value.ratingValue) &&
        value.ratingValue! >= selector.min! &&
        value.ratingValue! <= selector.max! &&
        value.choiceIds === undefined &&
        value.orderedChoiceIds === undefined &&
        value.numericValue === undefined &&
        value.textValue === undefined
      )
        key = String(value.ratingValue);
      const bucket =
        key === undefined
          ? undefined
          : buckets.find((bucket) =>
              selector.type === "poll" ? same(bucket.key, key!) : bucket.key === key,
            );
      if (bucket) bucket.count++;
    }
    result.push({ blockId: selector.blockId, responseCount, buckets });
  }
  return result;
}
/** One workspace-scoped aggregate statement; entered values and response principals never leave SQL. */
export async function postgresInsightsOpinionCounts(
  repository: PostgresRepository,
  workspaceId: string,
  sessionId: string,
  selectors: PresentationInsightsOpinionSelector[],
  now: Date,
): Promise<PresentationInsightsOpinionCount[]> {
  const client = await repository.pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('app.workspace_id',$1,true)", [workspaceId]);
    await client.query("SET LOCAL statement_timeout = '1500ms'");
    const result = await client.query(
      `WITH requested AS (
      SELECT value AS selector, ordinality AS position FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY
    ), bound AS (
      SELECT requested.*,session.id AS session_id FROM requested JOIN presentation_live_sessions session ON session.workspace_id=$1 AND session.id=$2 JOIN workspaces workspace ON workspace.id=session.workspace_id
      JOIN LATERAL jsonb_array_elements(session.content_snapshot->'blocks') block ON CASE WHEN (selector->>'semanticIds')::boolean THEN lower(block->>'id')=lower(selector->>'blockId') ELSE block->>'id'=selector->>'blockId' END
      WHERE session.status='finished' AND session.retention_expires_at>GREATEST($4::timestamptz,clock_timestamp()) AND workspace.deletion_started_at IS NULL
      AND (selector->>'semanticIds')::boolean=(COALESCE((session.content_snapshot->>'schemaVersion')::integer,1)>=12)
      AND block->>'kind'='question' AND block->'question'->>'type'=selector->>'type'
      AND CASE WHEN (selector->>'semanticIds')::boolean THEN lower(block->'question'->>'id')=lower(selector->>'questionId') ELSE block->'question'->>'id'=selector->>'questionId' END
      AND CASE WHEN selector->>'type'='poll' THEN COALESCE((block->'question'->>'maxSelections')::integer,1)=1 AND (SELECT jsonb_agg(choice->'id' ORDER BY position) FROM jsonb_array_elements(block->'question'->'choices') WITH ORDINALITY AS choices(choice,position))=selector->'choiceIds'
      ELSE block->'question'->'min'=selector->'min' AND block->'question'->'max'=selector->'max' END
    ), accepted AS MATERIALIZED (
      SELECT bound.position, bound.selector, response.response FROM bound JOIN presentation_live_responses response ON response.workspace_id=$1 AND response.session_id=bound.session_id AND response.block_id=(selector->>'blockId')::uuid AND response.question_id=(selector->>'questionId')::uuid
      WHERE response.response_schema_version IN(1,2) AND ((selector->>'semanticIds')::boolean OR (response.block_id::text=selector->>'blockId' AND response.question_id::text=selector->>'questionId'))
    ), classified AS (
      SELECT position,CASE WHEN selector->>'type'='poll' AND jsonb_typeof(response->'choiceIds')='array' AND CASE WHEN jsonb_typeof(response->'choiceIds')='array' THEN jsonb_array_length(response->'choiceIds') ELSE 0 END=1 AND jsonb_typeof(response->'choiceIds'->0)='string' AND NOT response ?| ARRAY['orderedChoiceIds','ratingValue','numericValue','textValue'] THEN response->'choiceIds'->>0
      WHEN selector->>'type'='rating' AND jsonb_typeof(response->'ratingValue')='number' AND (response->>'ratingValue')~'^[0-9]{1,3}$' AND NOT response ?| ARRAY['choiceIds','orderedChoiceIds','numericValue','textValue'] THEN response->>'ratingValue' ELSE NULL END AS key FROM accepted
    ), definitions AS (
      SELECT bound.position,bound.selector,keys.key,keys.ordinality FROM bound CROSS JOIN LATERAL (
        SELECT value AS key,ordinality FROM jsonb_array_elements_text(CASE WHEN selector->>'type'='poll' THEN selector->'choiceIds' ELSE (SELECT jsonb_agg(value::text ORDER BY value) FROM generate_series((selector->>'min')::integer,(selector->>'max')::integer) value) END) WITH ORDINALITY
      ) keys
    ), buckets AS (
      SELECT definitions.position,definitions.selector,definitions.key,definitions.ordinality,count(classified.key)::integer AS count FROM definitions LEFT JOIN classified ON classified.position=definitions.position AND CASE WHEN (definitions.selector->>'semanticIds')::boolean AND definitions.selector->>'type'='poll' THEN lower(classified.key)=lower(definitions.key) ELSE classified.key=definitions.key END GROUP BY definitions.position,definitions.selector,definitions.key,definitions.ordinality
    ) SELECT bound.selector->>'blockId' AS block_id,(SELECT count(*)::integer FROM accepted WHERE accepted.position=bound.position) AS response_count,COALESCE((SELECT jsonb_agg(jsonb_build_object('key',buckets.key,'count',buckets.count) ORDER BY buckets.ordinality) FROM buckets WHERE buckets.position=bound.position),'[]'::jsonb) AS buckets FROM bound ORDER BY bound.position`,
      [workspaceId, sessionId, JSON.stringify(selectors), now],
    );
    await client.query("COMMIT");
    return result.rows.map((row) => ({
      blockId: String(row.block_id),
      responseCount: Number(row.response_count),
      buckets: row.buckets,
    }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
