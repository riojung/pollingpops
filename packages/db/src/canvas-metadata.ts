import type { CanvasBoardGroupGrant, CanvasBoardRole } from "@openround/contracts";
import type { CanvasAccessContext, CanvasActor, CanvasSceneRead } from "./canvas-board-types.js";

export function canvasBoardRole(
  state: Pick<CanvasSceneRead, "board" | "grants">,
  actor: CanvasActor,
  access: CanvasAccessContext,
  groupGrants: CanvasBoardGroupGrant[] = [],
): CanvasBoardRole | null {
  if (
    (state.board.ownerUserId === actor.userId && access.workspace.membership) ||
    (access.workspace.ownerId === actor.userId && access.workspace.membership === "owner")
  )
    return "owner";
  const ranks = { viewer: 1, editor: 2, facilitator: 3 };
  return [
    ...state.grants.filter((grant) => grant.userId === actor.userId).map((grant) => grant.role),
    ...groupGrants.map((grant) => grant.role),
  ].reduce<CanvasBoardRole | null>(
    (best, role) => (!best || (best !== "owner" && ranks[role] > ranks[best]) ? role : best),
    null,
  );
}

/** Visibility is distinct from editable-seat policy: existing viewer reads survive plan changes.
 * Keep the set-based Postgres recent-metadata predicate equivalent to this canonical read rule. */
export function canvasMetadataRole(
  state: Pick<CanvasSceneRead, "board" | "grants">,
  actor: CanvasActor,
  access: CanvasAccessContext | null,
  groupGrants: CanvasBoardGroupGrant[] = [],
): CanvasBoardRole | null {
  if (
    !access?.user?.verified ||
    access.workspaceDeleting ||
    access.organization?.status !== "active" ||
    access.workspace.status !== "active" ||
    (!access.member &&
      !(access.organization.accountType === "personal" && access.workspace.membership))
  )
    return null;
  const role = canvasBoardRole(state, actor, access, groupGrants);
  if (!role || (access.member?.role === "billing" && role !== "viewer")) return null;
  if (
    access.organization.licenseUnit === "user" &&
    role !== "viewer" &&
    !access.assignments.some((assignment) => assignment.userId === actor.userId)
  )
    return null;
  return role;
}

/** Actor-scoped discovery/count in one statement, independent of the library's page cap.
 * RLS still restricts canvas/grant discovery; the trusted metadata query's temporary system
 * context permits joining the owning organizations/workspaces without loading their bodies.
 * Visibility mirrors canvasMetadataRole; current editing capabilities are rechecked only for
 * the bounded recent page by CanvasBoardRepository.authorizedMetadata. */
export const canvasRecentMetadataSql = `
WITH group_roles AS (
  SELECT grant_row.board_id,
    max(CASE grant_row.role WHEN 'facilitator' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END) AS rank
  FROM canvas_board_group_grants grant_row
  JOIN collaboration_groups groups ON groups.id=grant_row.group_id AND groups.workspace_id=grant_row.workspace_id
  JOIN collaboration_group_members membership ON membership.group_id=groups.id AND membership.workspace_id=groups.workspace_id AND membership.user_id=$1::uuid
  JOIN workspace_members workspace_member ON workspace_member.workspace_id=groups.workspace_id AND workspace_member.user_id=membership.user_id
  GROUP BY grant_row.board_id
), candidates AS (
  SELECT board.*, workspace.organization_id AS owning_organization_id,
    organization.license_unit, member.role AS organization_role,
    CASE WHEN (board.owner_user_id=$1::uuid AND workspace_member.user_id IS NOT NULL)
      OR (workspace.owner_id=$1::uuid AND workspace_member.role='owner') THEN 'owner'
      ELSE CASE greatest(CASE direct.role WHEN 'facilitator' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END, coalesce(group_roles.rank,0))
        WHEN 3 THEN 'facilitator' WHEN 2 THEN 'editor' WHEN 1 THEN 'viewer' END
    END AS actor_role
  FROM canvas_boards board
  JOIN workspaces workspace ON workspace.id=board.workspace_id AND workspace.platform_status='active'
  JOIN organizations organization ON organization.id=workspace.organization_id AND organization.status='active'
  JOIN users principal ON principal.id=$1::uuid AND principal.email_verified_at IS NOT NULL AND principal.deleted_at IS NULL
  LEFT JOIN workspace_members workspace_member ON workspace_member.workspace_id=workspace.id AND workspace_member.user_id=principal.id
  LEFT JOIN organization_members member ON member.organization_id=organization.id AND member.user_id=principal.id
  LEFT JOIN canvas_board_grants direct ON direct.board_id=board.id AND direct.user_id=principal.id
  LEFT JOIN group_roles ON group_roles.board_id=board.id
  LEFT JOIN idea_boards source ON source.id=board.source_board_id
  WHERE board.status<>'archived' AND board.expires_at>$3::timestamptz
    AND (member.user_id IS NOT NULL OR (organization.account_type='personal' AND workspace_member.user_id IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM workspace_media_deletion_jobs deletion WHERE deletion.workspace_id=workspace.id)
    AND (board.source_board_id IS NULL OR (source.data->>'expiresAt')::timestamptz>$3::timestamptz)
), eligible AS MATERIALIZED (
  SELECT * FROM candidates
  WHERE actor_role IS NOT NULL AND (workspace_id=$2::uuid OR actor_role<>'owner')
    AND (organization_role IS DISTINCT FROM 'billing' OR actor_role='viewer')
    AND (license_unit<>'user' OR actor_role='viewer' OR EXISTS (
      SELECT 1 FROM platform_records assignment WHERE assignment.kind='user_license'
        AND assignment.organization_id=candidates.owning_organization_id AND assignment.data->>'userId'=$1::text
    ))
)
SELECT (SELECT count(*)::text FROM eligible) AS total,
  coalesce((SELECT jsonb_agg(source_board_id ORDER BY source_board_id) FROM eligible
    WHERE workspace_id=$2::uuid AND source_board_id IS NOT NULL),'[]'::jsonb) AS linked_sources,
  coalesce((SELECT jsonb_agg(to_jsonb(recent) ORDER BY recent.updated_at DESC,recent.id)
    FROM (SELECT * FROM eligible ORDER BY updated_at DESC,id LIMIT $4) recent),'[]'::jsonb) AS boards
`;
