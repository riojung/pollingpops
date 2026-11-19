import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { SurveyDraftSchema } from "@openround/contracts/surveys";
import { SurveyReadableDraftSchema } from "@openround/contracts/survey-branching";
import type { PostgresRepository } from "./postgres.js";
import {
  upcastRoundContent,
  upcastPresentationContent,
  roundArtifactSchemaVersion,
} from "./artifact-schemas.js";
import {
  LibrarySharingError,
  librarySharingSeat,
  type LibrarySharingRun,
  type LibrarySharingTransaction,
  type StoredLibraryShare,
  type LibraryShareSnapshot,
  type LibrarySharingContext,
} from "./library-sharing.js";
import { PostgresPlatformStore } from "./platform-postgres.js";
import type {
  OrganizationRecord,
  PlatformSubscription,
  UserLicenseAssignment,
} from "./platform-types.js";

const columns =
  "share.id,share.organization_id,share.workspace_id,share.artifact_type,share.artifact_id,share.version_id,share.title,share.description,share.audience,share.recipient_ids,share.permission,share.message,share.due_at,share.created_by,share.request_id,share.intent_hash,share.shared_at,share.revoked_at,CASE WHEN share.artifact_type='survey' THEN (share.snapshot->'content'->>'schemaVersion')::integer ELSE NULL END AS survey_schema_version";
const sourceExists = `(CASE share.artifact_type
  WHEN 'round' THEN EXISTS(SELECT 1 FROM quizzes parent WHERE parent.workspace_id=share.workspace_id AND parent.id=share.artifact_id AND parent.status<>'archived')
  WHEN 'presentation' THEN EXISTS(SELECT 1 FROM presentations parent WHERE parent.workspace_id=share.workspace_id AND parent.id=share.artifact_id AND parent.status<>'archived')
  ELSE EXISTS(SELECT 1 FROM surveys parent WHERE parent.workspace_id=share.workspace_id AND parent.id=share.artifact_id AND parent.data->>'status'<>'archived') END)`;
function map(row: QueryResultRow): StoredLibraryShare {
  return {
    id: row.id,
    organizationId: row.organization_id,
    sourceWorkspaceId: row.workspace_id,
    artifactType: row.artifact_type,
    artifactId: row.artifact_id,
    versionId: row.version_id,
    title: row.title,
    description: row.description,
    audience: row.audience,
    recipientIds: row.recipient_ids,
    permission: row.permission,
    message: row.message,
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
    createdBy: row.created_by,
    requestId: row.request_id,
    intentHash: row.intent_hash,
    sharedAt: new Date(row.shared_at).toISOString(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    surveySchemaVersion: row.survey_schema_version ?? undefined,
    ...(row.snapshot ? { snapshot: row.snapshot as LibraryShareSnapshot } : {}),
  };
}
async function system<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
  const previous =
    (await client.query("SELECT current_setting('app.system_access',true) AS access")).rows[0]
      ?.access ?? "";
  await client.query("SELECT set_config('app.system_access','on',true)");
  const result = await work();
  await client.query("SELECT set_config('app.system_access',$1,true)", [previous]);
  return result;
}
export function createPostgresLibrarySharingRun(
  repository: PostgresRepository,
  communityMode = false,
): LibrarySharingRun {
  return async (actorId, work) => {
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.library_user_id',$1,true),set_config('app.user_id',$1,true)",
        [actorId],
      );
      // Match PlatformStore's identity fence: removal cannot commit between authority and mutation.
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('identity',73501))");
      const organizations = new Set<string>();
      const context = async (workspaceId: string): Promise<LibrarySharingContext | null> =>
        system(client, async () => {
          const found = await client.query("SELECT organization_id FROM workspaces WHERE id=$1", [
            workspaceId,
          ]);
          if (!found.rows[0]) return null;
          const organizationId: string = found.rows[0].organization_id;
          if (!organizations.has(organizationId)) {
            await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1,73501))", [
              `org:${organizationId}`,
            ]);
            organizations.add(organizationId);
          }
          const result = await client.query(
            `SELECT workspace.name AS workspace_name,workspace.platform_status,workspace.deletion_started_at,
            organization.id AS organization_id,organization.name AS organization_name,organization.status,organization.account_type,
            principal.deleted_at,principal.email_verified_at,member.role AS organization_role,member.created_at AS joined_at,
            EXISTS(SELECT 1 FROM workspace_media_deletion_jobs job WHERE job.workspace_id=workspace.id) AS deleting
           FROM workspaces workspace JOIN organizations organization ON organization.id=workspace.organization_id
           JOIN users principal ON principal.id=$2
           LEFT JOIN organization_members member ON member.organization_id=organization.id AND member.user_id=principal.id
           WHERE workspace.id=$1 FOR SHARE OF workspace,organization,principal`,
            [workspaceId, actorId],
          );
          const row = result.rows[0];
          if (!row) return null;
          const membership = await client.query(
            "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 FOR SHARE",
            [workspaceId, actorId],
          );
          await client.query(
            "SELECT user_id FROM organization_members WHERE organization_id=$1 AND user_id=$2 FOR SHARE",
            [organizationId, actorId],
          );
          const eligible =
            !!row.email_verified_at &&
            !row.deleted_at &&
            !!row.organization_role &&
            row.organization_role !== "billing" &&
            row.account_type === "organization" &&
            row.status === "active" &&
            row.platform_status === "active" &&
            !row.deletion_started_at &&
            !row.deleting;
          const platform = new PostgresPlatformStore(null, client);
          const seat = librarySharingSeat(
            await platform.get<OrganizationRecord>("organization", organizationId),
            await platform.get<PlatformSubscription>("subscription", organizationId),
            await platform.list<UserLicenseAssignment>("user_license", organizationId),
            !!(await platform.get<{ held: boolean }>("commercial_hold", organizationId))?.held,
            workspaceId,
            actorId,
            communityMode,
          );
          const create = ["owner", "editor"].includes(membership.rows[0]?.role) && seat;
          return {
            organizationId,
            organizationName: row.organization_name,
            workspaceName: row.workspace_name,
            eligible,
            create,
            manage:
              ["owner", "editor"].includes(membership.rows[0]?.role) ||
              ["owner", "admin"].includes(row.organization_role),
            joinedAt: row.joined_at ? new Date(row.joined_at).toISOString() : null,
          };
        });
      const tx: LibrarySharingTransaction = {
        context,
        source: async (workspaceId, type, artifactId, versionId) => {
          await client.query("SELECT set_config('app.workspace_id',$1,true)", [workspaceId]);
          if (type === "round") {
            const result = await client.query(
              "SELECT version.* FROM quizzes parent JOIN quiz_versions version ON version.workspace_id=parent.workspace_id AND version.quiz_id=parent.id WHERE parent.workspace_id=$1 AND parent.id=$2 AND parent.status<>'archived' AND version.id=$3 FOR SHARE OF parent",
              [workspaceId, artifactId, versionId],
            );
            const row = result.rows[0];
            return row
              ? {
                  artifactType: "round",
                  content: upcastRoundContent(row.content, row.content_schema_version),
                }
              : null;
          }
          if (type === "presentation") {
            const result = await client.query(
              "SELECT version.* FROM presentations parent JOIN presentation_versions version ON version.workspace_id=parent.workspace_id AND version.presentation_id=parent.id WHERE parent.workspace_id=$1 AND parent.id=$2 AND parent.status<>'archived' AND version.id=$3 FOR SHARE OF parent",
              [workspaceId, artifactId, versionId],
            );
            const row = result.rows[0];
            return row
              ? {
                  artifactType: "presentation",
                  content: upcastPresentationContent(row.content, row.content_schema_version),
                }
              : null;
          }
          const result = await client.query(
            "SELECT version.data FROM surveys parent JOIN survey_versions version ON version.workspace_id=parent.workspace_id AND version.survey_id=parent.id WHERE parent.workspace_id=$1 AND parent.id=$2 AND parent.data->>'status'<>'archived' AND version.id=$3 FOR SHARE OF parent",
            [workspaceId, artifactId, versionId],
          );
          return result.rows[0]
            ? {
                artifactType: "survey",
                content: SurveyReadableDraftSchema.parse(result.rows[0].data.content),
              }
            : null;
        },
        sourceExists: (row) =>
          system(client, async () => {
            const table =
              row.artifactType === "round"
                ? "quizzes"
                : row.artifactType === "presentation"
                  ? "presentations"
                  : "surveys";
            const status = row.artifactType === "survey" ? "data->>'status'" : "status";
            return !!(
              await client.query(
                `SELECT id FROM ${table} WHERE workspace_id=$1 AND id=$2 AND ${status}<>'archived' FOR SHARE`,
                [row.sourceWorkspaceId, row.artifactId],
              )
            ).rowCount;
          }),
        get: async (id, lock) => {
          // PostgreSQL row locks also apply UPDATE policies. Recipients may lock a
          // publication for copy/progress without receiving management authority.
          const select = async () => {
            const result = await client.query(
              `SELECT ${columns},share.snapshot FROM library_shares share WHERE share.id=$1 AND openround_library_actor_access(share.workspace_id,share.organization_id,share.audience,share.recipient_ids,'read',share.shared_at) AND (share.revoked_at IS NULL OR openround_library_actor_access(share.workspace_id,share.organization_id,share.audience,share.recipient_ids,'manage'))${lock ? " FOR UPDATE" : ""}`,
              [id],
            );
            return result.rows[0] ? map(result.rows[0]) : null;
          };
          return lock ? system(client, select) : select();
        },
        request: async (workspaceId, requestId) => {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,111))", [
            `library-create:${workspaceId}:${actorId}:${requestId}`,
          ]);
          const result = await client.query(
            `SELECT ${columns},share.snapshot FROM library_shares share WHERE share.workspace_id=$1 AND share.created_by=$2 AND share.request_id=$3`,
            [workspaceId, actorId, requestId],
          );
          return result.rows[0] ? map(result.rows[0]) : null;
        },
        list: async (input) => {
          // The authorized metadata set drives both the page and all counts. Only its schema
          // discriminator is projected from the snapshot; no snapshot body,
          // source draft, content, or media column is read by discovery.
          return system(client, async () => {
            const normalizedTitle = `normalize(lower(normalize(share.title,NFC) COLLATE "und-x-icu"),NFC) COLLATE "C"`;
            const ordering =
              input.sort === "recent"
                ? "share.shared_at DESC,share.id DESC"
                : `${normalizedTitle} ${input.sort === "title_asc" ? "ASC" : "DESC"},share.id DESC`;
            const boundary =
              input.sort === "recent"
                ? "(share.shared_at,share.id)<($9::timestamptz,$10::uuid)"
                : `(${normalizedTitle} ${input.sort === "title_asc" ? ">" : "<"} $11::text COLLATE "C" OR (${normalizedTitle}=$11::text COLLATE "C" AND share.id<$10::uuid))`;
            const search = input.q
              .normalize("NFC")
              .toLowerCase()
              .normalize("NFC")
              .replace(/[\\%_]/g, (character) => `\\${character}`);
            const result = await client.query(
              `WITH authorized AS MATERIALIZED (
                SELECT ${columns},organization.name AS organization_name,workspace.name AS workspace_name,
                  coalesce(progress.status,'new') AS progress_status,
                  openround_library_actor_access(share.workspace_id,share.organization_id,share.audience,share.recipient_ids,'manage') AS can_manage
                FROM library_shares share
                JOIN organizations organization ON organization.id=share.organization_id
                JOIN workspaces workspace ON workspace.id=share.workspace_id AND workspace.organization_id=share.organization_id
                LEFT JOIN library_share_progress progress ON progress.share_id=share.id AND progress.user_id=$3::uuid
                WHERE share.revoked_at IS NULL
                  AND openround_library_actor_access(share.workspace_id,share.organization_id,share.audience,share.recipient_ids,'read',share.shared_at)
                  AND ($1::uuid IS NULL OR share.organization_id=$1)
                  AND CASE $2 WHEN 'organization' THEN share.audience='organization'
                    WHEN 'shared' THEN share.audience='people' AND $3::uuid=ANY(share.recipient_ids)
                    ELSE openround_library_actor_access(share.workspace_id,share.organization_id,share.audience,share.recipient_ids,'manage') END
                  AND ${sourceExists}
                  AND ($4='' OR normalize(lower(normalize(share.title,NFC) COLLATE "und-x-icu"),NFC) LIKE $4 ESCAPE E'\\\\' OR normalize(lower(normalize(share.description,NFC) COLLATE "und-x-icu"),NFC) LIKE $4 ESCAPE E'\\\\'
                    OR normalize(lower(normalize(share.message,NFC) COLLATE "und-x-icu"),NFC) LIKE $4 ESCAPE E'\\\\' OR normalize(lower(normalize(organization.name,NFC) COLLATE "und-x-icu"),NFC) LIKE $4 ESCAPE E'\\\\'
                    OR normalize(lower(normalize(workspace.name,NFC) COLLATE "und-x-icu"),NFC) LIKE $4 ESCAPE E'\\\\')
              ), filtered AS MATERIALIZED (
                SELECT * FROM authorized WHERE ($5='all' OR artifact_type=$5)
                  AND ($6='all' OR progress_status=$6) AND ($7='all' OR permission=$7)
              ), page AS (
                SELECT share.* FROM filtered share WHERE ($9::timestamptz IS NULL OR ${boundary})
                ORDER BY ${ordering} LIMIT $8
              )
              SELECT coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${ordering.replaceAll("share.", "page.")}) FROM page),'[]'::jsonb) AS shares,
                jsonb_build_object(
                  'kinds',jsonb_build_object('round',count(*) FILTER(WHERE artifact_type='round'),'presentation',count(*) FILTER(WHERE artifact_type='presentation'),'survey',count(*) FILTER(WHERE artifact_type='survey')),
                  'progress',jsonb_build_object('new',count(*) FILTER(WHERE progress_status='new'),'in_progress',count(*) FILTER(WHERE progress_status='in_progress'),'done',count(*) FILTER(WHERE progress_status='done')),
                  'permissions',jsonb_build_object('view',count(*) FILTER(WHERE permission='view'),'use',count(*) FILTER(WHERE permission='use')),
                  'total',(SELECT count(*) FROM filtered)) AS facets
              FROM authorized`,
              [
                input.organizationId ?? null,
                input.scope,
                actorId,
                input.q ? `%${search}%` : "",
                input.kind,
                input.progress,
                input.permission,
                input.limit,
                input.after?.sharedAt ?? null,
                input.after?.id ?? null,
                ...(input.sort === "recent" ? [] : [input.after?.title ?? null]),
              ],
            );
            const found = result.rows[0]!;
            return {
              rows: found.shares.map((row: QueryResultRow) => ({
                ...map(row),
                progress: row.progress_status,
                context: {
                  organizationId: row.organization_id,
                  organizationName: row.organization_name,
                  workspaceName: row.workspace_name,
                  eligible: true,
                  create: false,
                  manage: row.can_manage,
                  joinedAt: null,
                },
              })),
              facets: found.facets,
            };
          });
        },
        insert: async (row) => {
          await client.query(
            `INSERT INTO library_shares(id,organization_id,workspace_id,artifact_type,artifact_id,version_id,title,description,snapshot,audience,recipient_ids,permission,message,due_at,created_by,request_id,intent_hash,shared_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [
              row.id,
              row.organizationId,
              row.sourceWorkspaceId,
              row.artifactType,
              row.artifactId,
              row.versionId,
              row.title,
              row.description,
              row.snapshot,
              row.audience,
              row.recipientIds,
              row.permission,
              row.message,
              row.dueAt,
              row.createdBy,
              row.requestId,
              row.intentHash,
              row.sharedAt,
            ],
          );
        },
        revoke: async (id, now) => {
          await client.query(
            "UPDATE library_shares SET revoked_at=coalesce(revoked_at,$2) WHERE id=$1",
            [id, now],
          );
        },
        status: async (id) =>
          (
            await client.query(
              "SELECT status FROM library_share_progress WHERE share_id=$1 AND user_id=$2",
              [id, actorId],
            )
          ).rows[0]?.status ?? "new",
        setStatus: async (id, status, now) => {
          await client.query(
            "INSERT INTO library_share_progress(share_id,user_id,status,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(share_id,user_id) DO UPDATE SET status=EXCLUDED.status,updated_at=EXCLUDED.updated_at",
            [id, actorId, status, now],
          );
        },
        recipients: (organizationId, search, ids) =>
          system(client, async () => {
            const result = await client.query(
              "SELECT principal.id AS user_id,principal.email FROM organization_members member JOIN users principal ON principal.id=member.user_id WHERE member.organization_id=$1 AND member.role<>'billing' AND principal.deleted_at IS NULL AND principal.email_verified_at IS NOT NULL AND ($3::uuid[] IS NULL OR principal.id=ANY($3)) AND strpos(lower(principal.email),lower($2))>0 ORDER BY principal.email,principal.id LIMIT 100",
              [organizationId, search, ids ?? null],
            );
            return result.rows.map((row) => ({ userId: row.user_id, email: row.email }));
          }),
        copyReceipt: async (requestId) => {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,111))", [
            `library-copy:${actorId}:${requestId}`,
          ]);
          const row = (
            await client.query(
              "SELECT * FROM library_share_copies WHERE user_id=$1 AND request_id=$2",
              [actorId, requestId],
            )
          ).rows[0];
          return row
            ? {
                shareId: row.share_id,
                destinationWorkspaceId: row.workspace_id,
                artifactType: row.artifact_type,
                artifactId: row.artifact_id,
              }
            : null;
        },
        sourceMediaValid: (workspaceId, sources) =>
          system(client, async () => {
            for (const source of sources) {
              const found = await client.query(
                "SELECT id FROM media_assets WHERE workspace_id=$1 AND id=$2 AND object_key=$3 AND mime_type=$4 AND size_bytes=$5 AND scan_status='clean' AND deletion_started_at IS NULL FOR SHARE",
                [workspaceId, source.id, source.objectKey, source.mimeType, source.sizeBytes],
              );
              if (!found.rowCount) return false;
            }
            return true;
          }),
        copy: async (row, workspaceId, requestId, value, now) => {
          await client.query("SELECT set_config('app.workspace_id',$1,true)", [workspaceId]);
          for (const asset of value.mediaAssets)
            await client.query(
              "INSERT INTO media_assets(id,workspace_id,object_key,mime_type,size_bytes,scan_status,alt_text,created_at) VALUES($1,$2,$3,$4,$5,'clean',$6,$7)",
              [
                asset.id,
                workspaceId,
                asset.objectKey,
                asset.mimeType,
                asset.sizeBytes,
                asset.altText,
                now,
              ],
            );
          const id = randomUUID(),
            historyId = randomUUID(),
            draft = value.snapshot.content;
          if (
            value.snapshot.artifactType === "round" ||
            value.snapshot.artifactType === "presentation"
          ) {
            const round = value.snapshot.artifactType === "round",
              table = round ? "quizzes" : "presentations",
              history = round ? "quiz_draft_history" : "presentation_draft_history",
              foreign = round ? "quiz_id" : "presentation_id";
            const version =
              value.snapshot.artifactType === "round"
                ? roundArtifactSchemaVersion(value.snapshot.content)
                : value.snapshot.content.schemaVersion;
            await client.query(
              `INSERT INTO ${table}(id,workspace_id,title,description,status,draft,draft_revision,draft_schema_version,last_edited_by,created_at,updated_at) VALUES($1,$2,$3,$4,'draft',$5,0,$6,$7,$8,$8)`,
              [id, workspaceId, draft.title, draft.description ?? "", draft, version, actorId, now],
            );
            await client.query(
              `INSERT INTO ${history}(id,workspace_id,${foreign},revision,draft,draft_schema_version,saved_by,created_at) VALUES($1,$2,$3,0,$4,$5,$6,$7)`,
              [historyId, workspaceId, id, draft, version, actorId, now],
            );
          } else {
            const content = SurveyDraftSchema.parse(value.snapshot.content);
            const record = {
              schemaVersion: content.schemaVersion,
              id,
              workspaceId,
              draft: content,
              revision: 0,
              status: "draft",
              versionId: null,
              publishedRevision: null,
              folderId: null,
              updatedAt: now.toISOString(),
            };
            await client.query(
              "INSERT INTO surveys(id,workspace_id,data,updated_at) VALUES($1,$2,$3,$4)",
              [id, workspaceId, record, now],
            );
          }
          await client.query(
            "INSERT INTO library_share_copies(user_id,request_id,share_id,workspace_id,artifact_type,artifact_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [actorId, requestId, row.id, workspaceId, row.artifactType, id, now],
          );
          return { artifactType: row.artifactType, artifactId: id, replayed: false };
        },
      };
      const result = await work(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && error.code === "23514")
        throw new LibrarySharingError(
          "VALIDATION_ERROR",
          error instanceof Error ? error.message : undefined,
        );
      throw error;
    } finally {
      client.release();
    }
  };
}
