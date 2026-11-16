import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { nativeEditorCopy } from "./native-editor-copy";
import {
  nativeTextVideoCopy,
  nativeTextVideoCopyKeys,
  nativeTextVideoValidationFeedback,
} from "./native-text-video-copy";

const placeholders = (text: string) => text.match(/\{\w+\}/g)?.sort() ?? [];

describe("native text and video copy", () => {
  it.each(supportedLocales)("covers every key and placeholder in %s", (locale) => {
    const copy = nativeTextVideoCopy(locale);
    for (const key of nativeTextVideoCopyKeys) {
      const message = copy(key);
      expect(message.trim(), key).not.toBe("");
      expect(placeholders(message), key).toEqual(placeholders(key));
      const values = Object.fromEntries(
        placeholders(key).map((token) => [token.slice(1, -1), `Original ${token} <author value>`]),
      );
      for (const value of Object.values(values)) expect(copy(key, values), key).toContain(value);
      if (locale === "en-CA") expect(message, key).toBe(key);
      else expect(message, key).not.toBe(key);
    }
  });

  it("has a unique inventory, defaults to English and delegates shared labels", () => {
    expect(new Set(nativeTextVideoCopyKeys).size).toBe(nativeTextVideoCopyKeys.length);
    for (const key of nativeTextVideoCopyKeys) expect(nativeTextVideoCopy()(key), key).toBe(key);
    for (const locale of supportedLocales)
      for (const key of ["Native slide title", "Node text"] as const)
        expect(nativeTextVideoCopy(locale)(key)).toBe(nativeEditorCopy(locale)(key));
  });

  it("provides concrete Korean controls and recovery messages", () => {
    const copy = nativeTextVideoCopy("ko-KR");
    expect(copy("Text formatting")).toBe("텍스트 서식");
    expect(copy("Bold")).toBe("굵게");
    expect(copy("Italic")).toBe("기울임꼴");
    expect(copy("Paragraph style")).toBe("문단 스타일");
    expect(copy("Link address")).toBe("링크 주소");
    expect(copy("Apply link")).toBe("링크 적용");
    expect(copy("Remove formatting")).toBe("서식 제거");
    expect(copy("External video")).toBe("외부 동영상");
    expect(copy("Video title")).toBe("동영상 제목");
    expect(copy("Video HTTPS link")).toBe("동영상 HTTPS 링크");
    expect(copy("Captions or transcript HTTPS link")).toBe("자막 또는 대본 HTTPS 링크");
    expect(copy("Add external video link")).toBe("외부 동영상 링크 추가");
    expect(copy("Undo and Redo are unavailable in this view.")).toBe(
      "이 보기에서는 실행 취소와 다시 실행을 사용할 수 없습니다.",
    );
    expect(copy("Use an HTTPS link without embedded credentials.")).toBe(
      "인증 정보가 포함되지 않은 HTTPS 링크를 사용하세요.",
    );
  });

  it.each([
    "Enter a complete http:// or https:// link without a username or password.",
    "This text change could not be matched to its selection. Try the edit again.",
    "Keep each HTTPS link within 2048 characters.",
    "Use an HTTPS link without embedded credentials.",
    "Give the video a title of at most 160 characters.",
  ] as const)("stores the known validation as a source key: %s", (key) => {
    expect(
      nativeTextVideoValidationFeedback(new Error(key), "Check the video and transcript links."),
    ).toEqual({ key });
  });

  it("maps known URL and schema validation while retaining unfamiliar diagnostics exactly", () => {
    const fallback = "Check the video and transcript links.";
    for (const message of ["Invalid URL", "Failed to construct 'URL': Invalid URL"])
      expect(nativeTextVideoValidationFeedback(new TypeError(message), fallback)).toEqual({
        key: "Enter a complete HTTPS link.",
      });
    expect(
      nativeTextVideoValidationFeedback(
        Object.assign(new Error("Schema details"), { issues: [] }),
        fallback,
      ),
    ).toEqual({ key: fallback });
    expect(nativeTextVideoValidationFeedback(null, fallback)).toEqual({ key: fallback });
    for (const message of [
      "Invalid URL",
      "Original diagnostic {token}: https://example.com?x=1&y=2",
    ])
      expect(nativeTextVideoValidationFeedback(new Error(message), fallback)).toEqual({
        diagnostic: message,
      });
  });
});
