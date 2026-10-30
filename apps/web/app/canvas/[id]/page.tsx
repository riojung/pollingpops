import { CanvasEditor } from "../../../components/canvas-boards/canvas-editor";

export default async function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CanvasEditor id={id} />;
}
