import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasBoardViewSchema } from "@openround/contracts";
import { boardFixture } from "../../test-utils/idea-board";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { CanvasWorkshopControls } from "./workshop-controls";

vi.mock("../locale-provider", () => ({
  useLocale: () => ({ t: (key: keyof typeof english) => english[key] ?? key }),
}));
const id = "00000000-0000-4000-8000-000000000008";
function fixture(facilitate = true) {
  return CanvasBoardViewSchema.parse({
    schemaVersion: 1,
    id,
    workspaceId: id,
    organizationId: id,
    ownerUserId: id,
    title: "Workshop",
    boardType: "workshop",
    sourceBoardId: boardFixture.id,
    status: "active",
    canvasSeq: 1,
    createdAt: boardFixture.createdAt,
    updatedAt: boardFixture.createdAt,
    expiresAt: "2099-10-01T00:00:00.000Z",
    role: facilitate ? "facilitator" : "editor",
    capabilities: { edit: true, facilitate, share: false, delete: false, archive: false },
    objects: [],
    grants: [],
    invitations: [],
    undoOperationId: null,
    redoOperationId: null,
    sourceBoard: {
      ...boardFixture,
      ideas: [
        ...boardFixture.ideas,
        { ...boardFixture.ideas[0], id, status: "pending", body: "Private pending idea" },
      ],
    },
  });
}

describe("canvas workshop controls", () => {
  it("reserves moderation and guest-card organization for facilitators", () => {
    const editor = renderToStaticMarkup(
      <CanvasWorkshopControls board={fixture(false)} onRefresh={() => {}} />,
    );
    expect(editor).toBe("");
    const facilitator = renderToStaticMarkup(
      <CanvasWorkshopControls board={fixture()} onRefresh={() => {}} />,
    );
    expect(facilitator).toContain("Private pending idea");
    expect(facilitator).toContain("Approve");
    expect(facilitator).toContain("Start voting");
    expect(facilitator).toContain("Group for idea");
  });
  it("removes collection and grouping actions after voting freezes the workshop", () => {
    const board = fixture();
    board.sourceBoard!.status = "voting";
    board.status = "frozen";
    const html = renderToStaticMarkup(
      <CanvasWorkshopControls board={board} onRefresh={() => {}} />,
    );
    expect(html).not.toContain("Private pending idea");
    expect(html).not.toContain("Start voting");
    expect(html).not.toContain("Group for idea");
    expect(html).toContain("Close board");
  });
  it("keeps the original workshop route discoverable for its owner", () => {
    const board = fixture();
    board.role = "owner";
    const html = renderToStaticMarkup(
      <CanvasWorkshopControls board={board} onRefresh={() => {}} />,
    );
    expect(html).toContain("Switch workspace and open workshop");
    expect(
      renderToStaticMarkup(<CanvasWorkshopControls board={fixture()} onRefresh={() => {}} />),
    ).not.toContain("Switch workspace and open workshop");
    board.workspaceId = "00000000-0000-4000-8000-000000000009";
    const otherWorkspace = renderToStaticMarkup(
      <CanvasWorkshopControls board={board} onRefresh={() => {}} />,
    );
    expect(otherWorkspace).toContain("Switch workspace and open workshop");
  });
});
