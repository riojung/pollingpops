import { PublicExamplesPage } from "../../components/public-examples-page";
import {
  publicExampleKinds,
  publicExampleUseCases,
  type PublicExampleKind,
  type PublicExampleUseCase,
} from "../../lib/public-examples";

export const metadata = {
  title: "Original examples and starters",
  description:
    "Preview original Rounds, Presentations, Surveys and board starters before making them your own.",
  alternates: { canonical: "/examples" },
};

export default async function ExamplesPage({
  searchParams,
}: {
  searchParams: Promise<{
    example?: string | string[];
    type?: string | string[];
    useCase?: string | string[];
  }>;
}) {
  const query = await searchParams;
  return (
    <PublicExamplesPage
      key={JSON.stringify([query.example, query.type, query.useCase])}
      initialExampleId={typeof query.example === "string" ? query.example : undefined}
      initialKind={
        typeof query.type === "string" && Object.hasOwn(publicExampleKinds, query.type)
          ? (query.type as PublicExampleKind)
          : "all"
      }
      initialUseCase={
        typeof query.useCase === "string" && Object.hasOwn(publicExampleUseCases, query.useCase)
          ? (query.useCase as PublicExampleUseCase)
          : "all"
      }
    />
  );
}
