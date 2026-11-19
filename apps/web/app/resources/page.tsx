import { PublicResourcesPage } from "../../components/public-resources-page";

export const metadata = {
  title: "Resources and practical guides",
  description:
    "Practical public guides for creating and joining Rounds, planning rechecks, understanding results and managing access.",
  alternates: { canonical: "/resources" },
};

export default function ResourcesPage() {
  return <PublicResourcesPage />;
}
