import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductFeaturePage } from "../../../components/public-product-pages";
import { getPublicProductPage, publicProductPages } from "../../../lib/public-product-content";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return publicProductPages.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = getPublicProductPage(slug);
  if (!page) notFound();
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/product/${page.slug}` },
    openGraph: {
      title: `${page.title} · Polling Pops`,
      description: page.description,
      url: `/product/${page.slug}`,
    },
  };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const page = getPublicProductPage(slug);
  if (!page) notFound();
  return <ProductFeaturePage page={page} />;
}
