import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../../../test-utils/english-locale";
import PresentationParticipantPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "presentation-session" }),
  usePathname: () => "/presentation-session/presentation-session/play",
  useRouter: () => ({ replace: vi.fn() }),
}));

describe("Presentation participant header", () => {
  it("keeps the visible and accessible brand readable on the hero header before connecting", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<PresentationParticipantPage />));
    const header = markup.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1];
    expect(header).toContain('data-inverted="true"');
    expect(header).toContain('style="color:white"');
    expect(header).toContain('<span class="sr-only">Polling Pops</span>');
    expect(header).toContain('class="brand-name"');
  });
});
