import { renderToStaticMarkup } from "react-dom/server";
import type { FormEvent, ReactElement } from "react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  code: "",
  push: vi.fn(),
  translate: vi.fn((key: string) => `translated:${key}`),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactModule>()),
  useId: () => "test-code",
  useState: () => [
    fixtures.code,
    (next: string) => {
      fixtures.code = next;
    },
  ],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: fixtures.push }) }));
vi.mock("./locale-provider", () => ({ useLocale: () => ({ t: fixtures.translate }) }));

import { JoinCodeForm } from "./join-code-form";

type FormProps = {
  onSubmit: (event: FormEvent) => void;
  children: [
    ReactElement<{
      children: [
        unknown,
        ReactElement<{ onChange: (event: { target: { value: string } }) => void }>,
      ];
    }>,
    ReactElement<{ disabled: boolean }>,
  ];
};

function form() {
  return JoinCodeForm({}) as ReactElement<FormProps>;
}

describe("shared public join code entry", () => {
  beforeEach(() => {
    fixtures.code = "";
    fixtures.push.mockReset();
    fixtures.translate.mockClear();
  });

  it("normalizes a formatted pasted code without losing leading zeroes or navigating", () => {
    const input = form().props.children[0].props.children[1];
    input.props.onChange({ target: { value: "00 123-45" } });
    expect(fixtures.code).toBe("0012345");
    expect(fixtures.push).not.toHaveBeenCalled();
    expect(form().props.children[1].props.disabled).toBe(false);
  });

  it("navigates only on a valid explicit submit, through the canonical join page", () => {
    const preventDefault = vi.fn();
    form().props.onSubmit({ preventDefault } as unknown as FormEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(fixtures.push).not.toHaveBeenCalled();
    fixtures.code = "0012345";
    form().props.onSubmit({ preventDefault } as unknown as FormEvent);
    expect(fixtures.push).toHaveBeenCalledExactlyOnceWith("/join?code=0012345");
  });

  it("keeps the original translated form name when no override is supplied", () => {
    const markup = renderToStaticMarkup(<JoinCodeForm />);
    expect(markup).toContain('aria-label="translated:delivery.join.formLabel"');
    expect(fixtures.translate).toHaveBeenCalledWith("delivery.join.formLabel");
  });

  it("allows a separately labelled compact instance without native paste truncation", () => {
    const markup = renderToStaticMarkup(
      <JoinCodeForm
        id="header-code"
        codeLabel="Seven-digit Round code"
        formLabel="Join a live Round"
        submitLabel="Join"
        className="header-form"
      />,
    );
    expect(markup).toContain('for="header-code"');
    expect(markup).toContain('id="header-code"');
    expect(markup).toContain('inputMode="numeric"');
    expect(markup).toContain('class="header-form"');
    expect(markup).toContain('aria-label="Join a live Round"');
    expect(fixtures.translate).not.toHaveBeenCalledWith("delivery.join.formLabel");
    expect(markup).toContain(">Join</button>");
    expect(markup).not.toContain("maxLength");
    expect(markup).not.toContain('type="number"');
  });
});
