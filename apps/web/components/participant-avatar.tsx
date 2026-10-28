"use client";

import { AVATAR_IDS, type AvatarId } from "@openround/contracts";
import { useId } from "react";
import { useLocale } from "./locale-provider";

export interface ParticipantAvatarDefinition {
  id: AvatarId;
  label: string;
  emoji: string;
  tone: "coral" | "gold" | "indigo" | "mint" | "plum" | "sky" | "teal" | "violet";
}

const avatarDetails: Record<AvatarId, Omit<ParticipantAvatarDefinition, "id">> = {
  comet: { label: "Comet", emoji: "☄️", tone: "violet" },
  fox: { label: "Fox", emoji: "🦊", tone: "coral" },
  owl: { label: "Owl", emoji: "🦉", tone: "gold" },
  otter: { label: "Otter", emoji: "🦦", tone: "teal" },
  panda: { label: "Panda", emoji: "🐼", tone: "mint" },
  robot: { label: "Robot", emoji: "🤖", tone: "sky" },
  rocket: { label: "Rocket", emoji: "🚀", tone: "indigo" },
  star: { label: "Star", emoji: "⭐", tone: "plum" },
  bear: { label: "Bear", emoji: "🐻", tone: "gold" },
  bunny: { label: "Bunny", emoji: "🐰", tone: "plum" },
  cat: { label: "Cat", emoji: "🐱", tone: "coral" },
  dog: { label: "Dog", emoji: "🐶", tone: "sky" },
  koala: { label: "Koala", emoji: "🐨", tone: "violet" },
  lion: { label: "Lion", emoji: "🦁", tone: "gold" },
  penguin: { label: "Penguin", emoji: "🐧", tone: "indigo" },
  tiger: { label: "Tiger", emoji: "🐯", tone: "coral" },
  turtle: { label: "Turtle", emoji: "🐢", tone: "mint" },
  dolphin: { label: "Dolphin", emoji: "🐬", tone: "sky" },
  whale: { label: "Whale", emoji: "🐳", tone: "indigo" },
  octopus: { label: "Octopus", emoji: "🐙", tone: "plum" },
  butterfly: { label: "Butterfly", emoji: "🦋", tone: "violet" },
  bee: { label: "Bee", emoji: "🐝", tone: "gold" },
  frog: { label: "Frog", emoji: "🐸", tone: "mint" },
  hedgehog: { label: "Hedgehog", emoji: "🦔", tone: "teal" },
};

export const PARTICIPANT_AVATARS: readonly ParticipantAvatarDefinition[] = AVATAR_IDS.map((id) => ({
  id,
  ...avatarDetails[id],
}));

const avatarById = new Map(PARTICIPANT_AVATARS.map((avatar) => [avatar.id, avatar]));

export function participantAvatarDefinition(avatarId?: AvatarId | null) {
  return avatarId ? avatarById.get(avatarId) : undefined;
}

export function ParticipantAvatar({
  avatarId,
  size = "medium",
  decorative = false,
}: {
  avatarId?: AvatarId | null;
  size?: "small" | "medium" | "large";
  decorative?: boolean;
}) {
  const { t } = useLocale();
  const avatar = participantAvatarDefinition(avatarId);
  const avatarLabel = avatar ? t(`live.avatar.${avatar.id}`) : t("live.avatar.participant");

  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={!decorative ? t("live.avatar.ariaLabel", { name: avatarLabel }) : undefined}
      className="participant-avatar"
      data-avatar={avatar?.id ?? "default"}
      data-size={size}
      data-tone={avatar?.tone ?? "sky"}
      role={!decorative ? "img" : undefined}
    >
      <span aria-hidden="true">{avatar?.emoji ?? "●"}</span>
    </span>
  );
}

export function ParticipantIdentity({
  avatarId,
  nickname,
  identityVisible = true,
  size = "small",
}: {
  avatarId?: AvatarId | null;
  nickname: string;
  identityVisible?: boolean;
  size?: "small" | "medium";
}) {
  return (
    <span className="participant-identity">
      <ParticipantAvatar
        avatarId={identityVisible ? avatarId : undefined}
        decorative={!identityVisible}
        size={size}
      />
      {/* Participant aliases can be written in any language, independently of the UI locale. */}
      <span lang="">{nickname}</span>
    </span>
  );
}

export function AvatarPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: AvatarId;
  onChange: (avatarId: AvatarId) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const helpId = useId();
  return (
    <fieldset aria-describedby={helpId} className="avatar-picker" disabled={disabled}>
      <legend>{t("live.avatar.choose")}</legend>
      <p className="muted" id={helpId}>
        {t("live.avatar.help")}
        <span className="avatar-picker-hint">
          {t("live.avatar.browse", { count: PARTICIPANT_AVATARS.length })}
        </span>
      </p>
      <div className="avatar-picker-grid">
        {PARTICIPANT_AVATARS.map((avatar) => (
          <label
            className="avatar-option"
            data-testid={`avatar-option-${avatar.id}`}
            key={avatar.id}
          >
            <input
              checked={value === avatar.id}
              name="participant-avatar"
              onChange={() => onChange(avatar.id)}
              required
              type="radio"
              value={avatar.id}
            />
            <span className="avatar-option-surface">
              <span aria-hidden="true" className="avatar-option-check">
                ✓
              </span>
              <ParticipantAvatar avatarId={avatar.id} decorative size="medium" />
              <span>{t(`live.avatar.${avatar.id}`)}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
