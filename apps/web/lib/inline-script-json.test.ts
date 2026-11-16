import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { serializeInlineScriptJson } from "./inline-script-json";

describe("inline script JSON", () => {
  it("keeps closing tags, HTML comments and Unicode separators inside JSON data", () => {
    const payload = {
      "</ScRiPt>": "</script><script>globalThis.injected = true</script>",
      comment: "<!--<script> --> & < >",
      separators: "before\u2028middle\u2029after",
      quoted: 'quotes " and backslashes \\ and newlines\n',
      nested: [{ color: "#17334A" }, null, true, 42],
    };
    const serialized = serializeInlineScriptJson(payload);
    expect(serialized).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(serialized)).toEqual(payload);

    const context: { payload?: unknown; injected?: boolean } = {};
    runInNewContext(`globalThis.payload = ${serialized}`, context);
    expect(context.payload).toEqual(payload);
    expect(context.injected).toBeUndefined();
  });

  it.each([undefined, () => undefined, Symbol("unsupported")])(
    "rejects a root value that cannot serialize to JSON: %s",
    (value) => expect(() => serializeInlineScriptJson(value)).toThrow(TypeError),
  );
});
