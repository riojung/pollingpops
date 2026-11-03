"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useLocale } from "../locale-provider";
import { canvasChromeCopy } from "../../lib/i18n/canvas-chrome-messages";
import { CanvasToolIcon, type CanvasToolIconName } from "./canvas-tool-icon";
import styles from "./canvas-topbar.module.css";

export type CanvasTopbarAction = {
  id: string;
  label: string;
  icon: CanvasToolIconName;
  onSelect: () => void;
  disabled?: boolean;
};
export type CanvasTopbarProps = {
  backLink: ReactNode;
  title: string;
  subtitle?: ReactNode;
  saveStatus: ReactNode;
  history?: ReactNode;
  assets?: ReactNode;
  panels?: ReactNode;
  presenter?: ReactNode;
  share?: ReactNode;
  insertActions: readonly CanvasTopbarAction[];
  panelReturnFocusRef?: RefObject<HTMLElement | null>;
};

/** Slots retain one mounted instance as CSS moves secondary actions into the narrow-screen tray. */
export function CanvasTopbar({
  backLink,
  title,
  subtitle,
  saveStatus,
  history,
  assets,
  panels,
  presenter,
  share,
  insertActions,
  panelReturnFocusRef,
}: CanvasTopbarProps) {
  const { locale } = useLocale();
  const copy = canvasChromeCopy(locale);
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const insertPanel = useRef<HTMLDivElement>(null);
  const actionPanel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState<"insert" | "actions" | null>(null);
  function close(restore = false) {
    setOpen(null);
    if (restore) trigger.current?.focus();
  }
  function toggle(next: "insert" | "actions", button: HTMLButtonElement) {
    trigger.current = button;
    setOpen((previous) => (previous === next ? null : next));
  }
  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(null);
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    const panel = open === "insert" ? insertPanel.current : actionPanel.current;
    panel
      ?.querySelector<HTMLElement>("button:not(:disabled),a[href],summary,select:not(:disabled)")
      ?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);
  function activateSlot(event: MouseEvent<HTMLDivElement>, restore: boolean, panel = false) {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (button && !button.disabled) {
      if (panel && panelReturnFocusRef) {
        panelReturnFocusRef.current = open === "actions" ? trigger.current : button;
      }
      close(restore && open === "actions");
    }
  }
  return (
    <>
      <header
        ref={root}
        className={styles.topbar}
        data-testid="canvas-topbar"
        aria-label={copy.quickActions}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          }
        }}
      >
        <div className={styles.back}>{backLink}</div>
        <div className={styles.identity}>
          <h1 lang="" dir="auto" title={title}>
            {title}
          </h1>
          <div className={styles.meta}>
            {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
            <div className={styles.status}>{saveStatus}</div>
          </div>
        </div>
        <div
          className={styles.actionsTray}
          ref={actionPanel}
          id={`${id}-actions`}
          data-open={open === "actions"}
          role="group"
          aria-label={copy.more}
        >
          <div className={styles.overflowHeading}>{copy.more}</div>
          {history ? (
            <div className={styles.history} onClick={(event) => activateSlot(event, true)}>
              {history}
            </div>
          ) : null}
          {panels ? (
            <div className={styles.panels} onClick={(event) => activateSlot(event, true, true)}>
              {panels}
            </div>
          ) : null}
          {presenter ? (
            <div
              className={styles.presenter}
              onClick={() => {
                if (open === "insert") close();
              }}
            >
              {presenter}
            </div>
          ) : null}
        </div>
        <div className={styles.insert}>
          <button
            type="button"
            className={styles.icon}
            aria-label={copy.insert}
            title={copy.insert}
            aria-expanded={open === "insert"}
            aria-controls={`${id}-insert`}
            disabled={!insertActions.length}
            onClick={(event) => toggle("insert", event.currentTarget)}
          >
            <CanvasToolIcon name="plus" />
          </button>
          <div
            hidden={open !== "insert"}
            ref={insertPanel}
            id={`${id}-insert`}
            className={styles.insertPanel}
            role="group"
            aria-label={copy.insert}
          >
            <p className={styles.menuHeading}>{copy.insert}</p>
            {insertActions.map((action) => (
              <button
                type="button"
                key={action.id}
                disabled={action.disabled}
                onClick={() => {
                  if (!action.disabled) {
                    trigger.current?.focus();
                    action.onSelect();
                    close();
                  }
                }}
              >
                <CanvasToolIcon name={action.icon} />
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className={`${styles.icon} ${styles.more}`}
          aria-label={copy.more}
          title={copy.more}
          aria-expanded={open === "actions"}
          aria-controls={`${id}-actions`}
          onClick={(event) => toggle("actions", event.currentTarget)}
        >
          <CanvasToolIcon name="more" />
        </button>
        {share ? (
          <div className={styles.share} onClick={(event) => activateSlot(event, false)}>
            {share}
          </div>
        ) : null}
      </header>
      {assets}
    </>
  );
}
