import { GuardedLink as Link } from "./navigation-guard";
import { PRODUCT_BRAND, type WorkspaceProductFeatures } from "@openround/contracts";
import { LollipopMark } from "./lollipop-mark";

interface BrandProps {
  href?: string;
  inverted?: boolean;
  name?: string;
}

export function Brand({ href = "/", inverted = false, name = PRODUCT_BRAND.name }: BrandProps) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toLocaleUpperCase())
    .join("");

  return (
    <Link
      className="brand"
      data-inverted={inverted || undefined}
      href={href}
      style={inverted ? { color: "white" } : undefined}
    >
      <span className={name === PRODUCT_BRAND.name ? "brand-pop" : "brand-mark"} aria-hidden="true">
        {name === PRODUCT_BRAND.name ? <LollipopMark /> : initials || "PP"}
      </span>
      <span className="sr-only">{name}</span>
      <span aria-hidden="true">{name}</span>
    </Link>
  );
}

type CreatorNavigationFeatures = Pick<WorkspaceProductFeatures, "workspaceShell">;

export function creatorLandingHref(
  productFeatures: CreatorNavigationFeatures | null | undefined,
): "/home" | "/dashboard" {
  return productFeatures?.workspaceShell === true ? "/home" : "/dashboard";
}

interface CreatorBrandProps extends Omit<BrandProps, "href"> {
  productFeatures?: CreatorNavigationFeatures | null;
}

export function CreatorBrand({ productFeatures, ...props }: CreatorBrandProps) {
  return <Brand {...props} href={creatorLandingHref(productFeatures)} />;
}
