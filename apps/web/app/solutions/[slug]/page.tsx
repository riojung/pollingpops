import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SolutionDetailPage } from "../../../components/public-product-pages";
import { getPublicSolutionPage, publicSolutionPages } from "../../../lib/public-product-content";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return publicSolutionPages.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = getPublicSolutionPage(slug);
  if (!page) notFound();
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/solutions/${page.slug}` },
    openGraph: {
      title: `${page.title} · Polling Pops`,
      description: page.description,
      url: `/solutions/${page.slug}`,
    },
  };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const page = getPublicSolutionPage(slug);
  if (!page) notFound();
  return <SolutionDetailPage page={page} />;
}
