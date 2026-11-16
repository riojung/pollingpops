// JSON string escaping alone does not stop the HTML parser from ending a script.
export function serializeInlineScriptJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("Inline script data must serialize to JSON");
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
