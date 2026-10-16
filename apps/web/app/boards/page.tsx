"use client";

import { BoardLibrary } from "../../components/idea-boards/board-library";
import { WorkspaceProvider } from "../../components/workspace/workspace-provider";

export default function BoardsPage() {
  return (
    <WorkspaceProvider>
      <BoardLibrary />
    </WorkspaceProvider>
  );
}
