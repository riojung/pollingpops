import { BoardHost } from "../../../components/idea-boards/board-host";
import { WorkspaceProvider } from "../../../components/workspace/workspace-provider";

export default async function BoardHostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <WorkspaceProvider>
      <BoardHost id={id} key={id} />
    </WorkspaceProvider>
  );
}
