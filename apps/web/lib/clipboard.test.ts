import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

const joinUrl = "http://192.168.1.142:8080/join?code=0123456";

function browser() {
  const state: { activeElement: FakeElement | null } = { activeElement: null };
  const savedRange = {};
  const originalRange = { cloneRange: vi.fn(() => savedRange) };
  let ranges: object[] = [originalRange];
  const fields: FakeTextarea[] = [];

  class FakeElement {
    focus = vi.fn(() => {
      state.activeElement = this;
    });
  }

  class FakeInput extends FakeElement {
    selectionStart = 2;
    selectionEnd = 5;
    selectionDirection = "backward";
    setSelectionRange = vi.fn((start: number, end: number, direction?: string) => {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction ?? "none";
    });
  }

  class FakeTextarea extends FakeInput {
    value = "";
    readOnly = false;
    tabIndex = 0;
    style = { cssText: "" };
    select = vi.fn(() => {
      ranges = [];
      this.setSelectionRange(0, this.value.length);
    });
    remove = vi.fn(() => {
      fields.splice(fields.indexOf(this), 1);
      if (state.activeElement === this) state.activeElement = null;
    });
  }

  const input = new FakeInput();
  input.focus();
  const selection = {
    get rangeCount() {
      return ranges.length;
    },
    getRangeAt: vi.fn(() => originalRange),
    removeAllRanges: vi.fn(() => {
      ranges = [];
    }),
    addRange: vi.fn((range: object) => {
      ranges.push(range);
    }),
  };
  const document = {
    get activeElement() {
      return state.activeElement;
    },
    createElement: vi.fn(() => new FakeTextarea()),
    body: { append: vi.fn((field: FakeTextarea) => fields.push(field)) },
    getSelection: vi.fn(() => selection),
    execCommand: vi.fn(() => true),
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("HTMLInputElement", FakeInput);
  vi.stubGlobal("HTMLTextAreaElement", FakeTextarea);

  return { document, input, fields, savedRange, selection };
}

afterEach(() => vi.unstubAllGlobals());

describe("copyTextToClipboard", () => {
  it("uses the secure Clipboard API without moving focus or creating a temporary field", async () => {
    const { document, input } = browser();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyTextToClipboard(joinUrl)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(joinUrl);
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(document.createElement).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("copies synchronously during the click when the API is absent on LAN HTTP", async () => {
    const { document, fields } = browser();
    document.execCommand.mockImplementation(() => {
      const field = fields[0]!;
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe(joinUrl);
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(joinUrl.length);
      expect(field.readOnly).toBe(true);
      return true;
    });

    const result = copyTextToClipboard(joinUrl);
    expect(document.execCommand).toHaveBeenCalledExactlyOnceWith("copy");
    await expect(result).resolves.toBe(true);
    expect(fields).toEqual([]);
  });

  it("tries selection copy when the secure API rejects the request", async () => {
    const { document } = browser();
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyTextToClipboard(joinUrl)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(joinUrl);
    expect(document.execCommand).toHaveBeenCalledExactlyOnceWith("copy");
  });

  it.each(["success", "false", "throw"])(
    "restores focus, input selection, page selection, and cleans up after legacy copy %s",
    async (outcome) => {
      const { document, input, fields, savedRange, selection } = browser();
      document.execCommand.mockImplementation(() => {
        // Focusing a different control can reset the user's previous input selection.
        input.selectionStart = 0;
        input.selectionEnd = 0;
        input.selectionDirection = "none";
        if (outcome === "throw") throw new Error("Copy denied");
        return outcome === "success";
      });

      await expect(copyTextToClipboard(joinUrl)).resolves.toBe(outcome === "success");
      expect(document.activeElement).toBe(input);
      expect(input.focus).toHaveBeenLastCalledWith({ preventScroll: true });
      expect(input.selectionStart).toBe(2);
      expect(input.selectionEnd).toBe(5);
      expect(input.selectionDirection).toBe("backward");
      expect(selection.addRange).toHaveBeenCalledExactlyOnceWith(savedRange);
      expect(fields).toEqual([]);
    },
  );

  it("reports failure when both browser copy methods are blocked", async () => {
    const { document } = browser();
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
    });
    document.execCommand.mockReturnValue(false);

    await expect(copyTextToClipboard(joinUrl)).resolves.toBe(false);
  });

  it("reports unsupported legacy copy without changing focus or creating a field", async () => {
    const { document, input } = browser();
    Object.assign(document, { execCommand: undefined });

    await expect(copyTextToClipboard(joinUrl)).resolves.toBe(false);
    expect(document.createElement).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });
});
