import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../test-utils/english-locale";
import { RoomPasswordInput, RoomPasswordOption } from "./room-password";

vi.mock("next/navigation", () => ({ usePathname: () => "/join" }));

const option = {
  enabled: false,
  password: "",
  onEnabledChange: () => undefined,
  onPasswordChange: () => undefined,
};

describe("room password controls", () => {
  it("explains unavailable protection without promising a particular plan", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<RoomPasswordOption {...option} available={false} />),
    );
    expect(markup).toContain("Availability depends on your plan and workspace settings.");
    expect(markup).toContain('href="/account"');
    expect(markup).not.toContain("<input");
  });

  it("defaults to an unchecked optional paid toggle", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<RoomPasswordOption {...option} available />),
    );
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("Require a password for this run");
    expect(markup).not.toContain('checked=""');
    expect(markup).not.toContain('type="password"');
  });

  it("keeps selected protection checked and usable for explicit opt-out when paid eligibility is lost", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <RoomPasswordOption {...option} available={false} enabled password="password" />,
      ),
    );
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('checked=""');
    expect(markup).not.toContain('disabled=""');
    expect(markup).toContain("Require a password for this run");
    expect(markup).toContain("Password protection is not enabled for this run.");
    expect(markup).not.toContain('type="password"');
  });

  it("labels and bounds the enabled creation input accessibly", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<RoomPasswordOption {...option} available enabled />),
    );
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="new-password"');
    expect(markup).toContain('minLength="8"');
    expect(markup).toContain('maxLength="128"');
    expect(markup).toContain("aria-describedby=");
    expect(markup).toContain('required=""');
  });

  it("uses a labelled password input with host guidance for admission", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<RoomPasswordInput value="" onChange={() => undefined} />),
    );
    expect(markup).toContain("Room password</label>");
    expect(markup).toContain("Enter the room password from your host.");
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).not.toContain("minLength=");
  });
});
