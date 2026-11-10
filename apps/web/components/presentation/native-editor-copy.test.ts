import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  nativeEditorCopy,
  nativeEditorCopyKeys,
  type NativeEditorCopyKey,
} from "./native-editor-copy";
import { nativeControlsCopy } from "./native-controls-copy";

const placeholders = (text: string) => text.match(/\{\w+\}/g)?.sort() ?? [];

describe("ordinary native editor copy", () => {
  it.each(supportedLocales)("covers the complete catalog and interpolation in %s", (locale) => {
    const copy = nativeEditorCopy(locale);
    for (const key of nativeEditorCopyKeys) {
      const message = copy(key);
      expect(message.trim(), key).not.toBe("");
      expect(placeholders(message), key).toEqual(placeholders(key));
      const values = Object.fromEntries(
        placeholders(key).map((token) => [token.slice(1, -1), `Original ${token} <author value>`]),
      );
      const interpolated = copy(key, values);
      for (const value of Object.values(values)) expect(interpolated, key).toContain(value);
      if (locale === "en-CA") expect(message, key).toBe(key);
    }
    if (locale !== "en-CA") {
      const primaryKeys = [
        "Customize your slide",
        "Slide tools",
        "Close inspector panel",
        "Native slide editor",
        "Editing on this slide",
        "Selected object",
        "Position and size",
        "Insert slide objects",
        "Text language",
        "New image description",
        "Checking image safety…",
        "Writing assistance",
        "Read object earlier",
        "Read object later",
      ] as const satisfies readonly NativeEditorCopyKey[];
      for (const key of primaryKeys) expect(copy(key), key).not.toBe(key);
      expect(
        copy("Include {name} in selection", { name: "Original author label" }).toLowerCase(),
      ).toContain(copy("Include in selection").toLowerCase());
    }
  });

  it("keeps the inventory unique and reuses shared labels consistently", () => {
    expect(new Set(nativeEditorCopyKeys).size).toBe(nativeEditorCopyKeys.length);
    for (const locale of supportedLocales) {
      const copy = nativeEditorCopy(locale);
      const shared = nativeControlsCopy(locale);
      for (const key of ["Slide title", "Image", "rounded rectangle", "center", "bar"] as const)
        expect(copy(key)).toBe(shared(key));
      expect(copy("{count} selected", { count: 0 })).toBe(shared("{count} selected", { count: 0 }));
    }
  });

  it("renders concrete Korean shell, fields, insert controls and accessibility names", () => {
    const copy = nativeEditorCopy("ko-KR");
    expect(copy("Customize your slide")).toBe("슬라이드 맞춤 설정");
    expect(copy("Slide tools")).toBe("슬라이드 도구");
    expect(copy("Close inspector panel")).toBe("속성 패널 닫기");
    expect(copy("Native slide editor")).toBe("네이티브 슬라이드 편집기");
    expect(copy("Selected object")).toBe("선택한 개체");
    expect(copy("Node text")).toBe("개체 텍스트");
    expect(copy("Shape label")).toBe("도형 레이블");
    expect(copy("Object color")).toBe("개체 색상");
    expect(copy("Object {field} (%)", { field: copy("width") })).toBe("개체 너비 (%)");
    expect(copy("Object {field} (%)", { field: copy("x") })).toBe("개체 x (%)");
    expect(copy("Text language")).toBe("텍스트 언어");
    expect(copy("Read object earlier")).toBe("개체를 먼저 읽기");
    expect(copy("Read object later")).toBe("개체를 나중에 읽기");
    expect(copy("Add native image")).toBe("네이티브 이미지 추가");
    expect(copy("Insert slide objects")).toBe("슬라이드 개체 삽입");
    expect(copy("Interactions")).toBe("상호작용");
    expect(copy("Insert more")).toBe("추가 삽입");
    expect(copy("Writing assistance")).toBe("글쓰기 지원");
    expect(copy("Add {kind} chart", { kind: copy("bar") })).toBe("막대 차트 추가");
    for (const key of ["Text", "Shape", "Connector"] as const) {
      const action = {
        Text: "Add native text",
        Shape: "Add native shape",
        Connector: "Add native connector",
      } as const;
      expect(copy(action[key])).toContain(copy(key));
    }
    const authoredName = "Original English label {field}";
    expect(copy("Include {name} in selection", { name: authoredName })).toBe(
      `${authoredName} 선택에 포함`,
    );
    expect(copy("Include {name} in selection", { name: authoredName })).toContain(
      copy("Include in selection"),
    );
  });

  it("preserves the recovery meaning of local errors and English source compatibility", () => {
    const key =
      "The language change cannot fit within the slide’s limits. Reduce content and try again; the current slide is retained.";
    expect(nativeEditorCopy()(key)).toBe(key);
    expect(nativeEditorCopy("ko-KR")(key)).toBe(
      "언어 변경이 슬라이드 제한을 초과합니다. 콘텐츠를 줄이고 다시 시도하세요. 현재 슬라이드는 유지됩니다.",
    );
    expect(nativeEditorCopy("ko-KR")("Uploading to quarantine…")).toBe("격리 영역에 업로드 중…");
    expect(
      nativeEditorCopy("ko-KR")("Uploads are unavailable until malware scanning is configured."),
    ).toBe("악성 코드 검사가 구성될 때까지 업로드를 사용할 수 없습니다.");
    expect(nativeEditorCopy()("Object {field} (%)", { field: "width" })).toBe("Object width (%)");
    expect(nativeEditorCopy()("{count} object selected", { count: 1 })).toBe("1 object selected");
    expect(nativeEditorCopy()("{count} objects selected", { count: 2 })).toBe("2 objects selected");
  });

  it("retains unresolved tokens and uses English only for an unsupported runtime locale", () => {
    expect(nativeEditorCopy("ko-KR")("Include {name} in selection")).toContain("{name}");
    const unsupportedLocale = "zz-ZZ" as SupportedLocale;
    const copy = nativeEditorCopy(unsupportedLocale);
    expect(copy("Native slide editor")).toBe("Native slide editor");
    expect(copy("{count} selected", { count: 2 })).toBe("2 selected");
    expect(copy("Include {name} in selection", { name: "" })).toBe("Include  in selection");
  });
});
