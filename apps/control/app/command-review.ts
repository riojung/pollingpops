/** Integration credentials stay in the pending command, but never appear in review text. */
export function commandReviewDetails(command: Record<string, unknown>) {
  if (command.action !== "integration.connect") return command;
  return Object.fromEntries(
    Object.entries(command).map(([key, value]) => [
      key,
      ["accessToken", "refreshToken", "clientSecret"].includes(key) ? "[hidden]" : value,
    ]),
  );
}
