import { PresentationBuilder } from "../../../components/presentation/presentation-builder";
import { WorkspaceProvider } from "../../../components/workspace/workspace-provider";

export default async function PresentationBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return (
    <WorkspaceProvider>
      <PresentationBuilder presentationId={id} startOutline={query.start === "outline"} />
    </WorkspaceProvider>
  );
}
