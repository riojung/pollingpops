import { notFound } from "next/navigation";
import { PublicResourcePage } from "../../../components/public-resources-page";
import { getPublicResource, publicResources } from "../../../lib/public-resources";

export function generateStaticParams() {
  return publicResources.map((resource) => ({ slug: resource.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const resource = getPublicResource((await params).slug);
  return resource
    ? {
        title: resource.title,
        description: resource.summary,
        alternates: { canonical: `/resources/${resource.slug}` },
      }
    : {};
}

export default async function ResourcePage({ params }: { params: Promise<{ slug: string }> }) {
  const resource = getPublicResource((await params).slug);
  if (!resource) notFound();
  return <PublicResourcePage resource={resource} />;
}
