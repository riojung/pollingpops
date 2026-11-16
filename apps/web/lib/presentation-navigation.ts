import {
  PresentationCommandSchema,
  PresentationCompanionCommandSchema,
  type PresentationCommand,
  type PresentationCompanionCommand,
  type PresentationControlCommand,
} from "@openround/contracts";

type NavigationCommand = Extract<
  PresentationControlCommand,
  { action: "jump_to_block" | "return_to_path" }
>;
type RecoverableCommand = Extract<
  PresentationControlCommand,
  { action: "jump_to_block" | "return_to_path" | "navigate_scene" | "follow_branch" | "set_reveal" }
>;
type NavigationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Credential = { controlToken: string } | { companionToken: string };

function pendingKey(sessionId: string, role: "host" | "companion") {
  return `openround:presentation-navigation:${role}:${sessionId}`;
}

export function isPresentationNavigationCommand(
  command: PresentationControlCommand,
): command is NavigationCommand {
  return command.action === "jump_to_block" || command.action === "return_to_path";
}

export function isPresentationRecoverableCommand(
  command: PresentationControlCommand,
): command is RecoverableCommand {
  return [
    "jump_to_block",
    "return_to_path",
    "navigate_scene",
    "follow_branch",
    "set_reveal",
  ].includes(command.action);
}

/** Keep the exact absolute action without credentials; bind the current tab's pass on restore. */
export function persistPresentationNavigationCommand(
  storage: NavigationStorage,
  sessionId: string,
  role: "host" | "companion",
  command: PresentationControlCommand | null,
) {
  try {
    const key = pendingKey(sessionId, role);
    if (!command || !isPresentationRecoverableCommand(command)) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(
      key,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(command).filter(
            ([field]) => field !== "controlToken" && field !== "companionToken",
          ),
        ),
      ),
    );
  } catch {
    // Browsers may deny storage. In-memory command recovery remains available.
  }
}

export function restorePresentationNavigationCommand(
  storage: NavigationStorage,
  sessionId: string,
  credential: { controlToken: string },
): PresentationCommand | null;
export function restorePresentationNavigationCommand(
  storage: NavigationStorage,
  sessionId: string,
  credential: { companionToken: string },
): PresentationCompanionCommand | null;
export function restorePresentationNavigationCommand(
  storage: NavigationStorage,
  sessionId: string,
  credential: Credential,
): PresentationControlCommand | null {
  const role = "controlToken" in credential ? "host" : "companion";
  const key = pendingKey(sessionId, role);
  try {
    const stored = storage.getItem(key);
    if (!stored) return null;
    const value: unknown = JSON.parse(stored);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid intent");
    // Strict parsing also rejects stored credentials, unrelated fields and future command types.
    const schema = role === "host" ? PresentationCommandSchema : PresentationCompanionCommandSchema;
    const command = schema.parse({ ...value, ...credential });
    if (command.sessionId !== sessionId || !isPresentationRecoverableCommand(command))
      throw new Error("Invalid navigation intent");
    if ("controlToken" in value || "companionToken" in value) throw new Error("Stored credential");
    return Object.freeze(command);
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* Storage may be unavailable. */
    }
    return null;
  }
}

export function presentationNavigationRetryLabel(command: PresentationControlCommand) {
  if (command.action === "return_to_path") return "Retry return acknowledgement";
  if (command.action === "jump_to_block") return "Retry jump acknowledgement";
  if (command.action === "navigate_scene") return "Retry slide link acknowledgement";
  if (command.action === "follow_branch") return "Retry branch acknowledgement";
  if (command.action === "set_reveal") return "Retry broadcast reveal acknowledgement";
  return "Retry action acknowledgement";
}
