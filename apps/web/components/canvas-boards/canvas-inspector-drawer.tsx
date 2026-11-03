"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { canvasChromeCopy } from "../../lib/i18n/canvas-chrome-messages";
import { useLocale } from "../locale-provider";
import { CanvasToolIcon } from "./canvas-tool-icon";
import styles from "./canvas-inspector-drawer.module.css";

export interface CanvasInspectorTab {
  id: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
}
export interface CanvasInspectorDrawerProps {
  open: boolean;
  title: string;
  tab: string;
  onTabChange: (id: string) => void;
  tabs: readonly CanvasInspectorTab[];
  onClose: () => void;
  disabled?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

const modalSelector =
  'dialog[open], [role="dialog"][aria-modal="true"]:not(dialog):not([hidden]):not([aria-hidden="true"])';

/** A nonmodal overlay: tab contents stay mounted so local discussion drafts survive. */
export function CanvasInspectorDrawer({
  open,
  title,
  tab,
  onTabChange,
  tabs,
  onClose,
  disabled = false,
  returnFocusRef,
}: CanvasInspectorDrawerProps) {
  const { locale } = useLocale();
  const copy = canvasChromeCopy(locale);
  const id = useId();
  const drawer = useRef<HTMLElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const activeTab = tabs.some((item) => item.id === tab) ? tab : tabs[0]?.id;

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (open && !wasOpen.current) {
      opener.current = returnFocusRef?.current ?? (active instanceof HTMLElement ? active : null);
      // A mobile canvas opener is covered and made inert by this same commit.
      // Hand focus into the panel before paint; visible header openers keep focus.
      if (opener.current?.closest("[inert]") && !document.querySelector(modalSelector))
        buttons.current.get(activeTab ?? "")?.focus();
    }
    if (
      !open &&
      wasOpen.current &&
      (drawer.current?.contains(active) || active === document.body) &&
      !document.querySelector(modalSelector)
    ) {
      const target = returnFocusRef?.current ?? opener.current;
      if (target?.isConnected && !target.closest("[inert]")) target.focus();
    }
    wasOpen.current = open;
  }, [open, returnFocusRef, activeTab]);

  useEffect(() => {
    if (!open) return;
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        !target ||
        (!drawer.current?.contains(target) &&
          target !== opener.current &&
          target !== returnFocusRef?.current)
      )
        return;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], dialog, [popover], [role="menu"], [role="listbox"]',
        ) ||
        document.querySelector(modalSelector)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, onClose, returnFocusRef]);

  return (
    <aside
      ref={drawer}
      data-testid="canvas-inspector"
      className={styles.drawer}
      data-open={open}
      aria-labelledby={`${id}-title`}
      aria-hidden={!open}
      inert={!open}
    >
      <header className={styles.header}>
        <div className={styles.topline}>
          <h2 id={`${id}-title`}>{title}</h2>
          <button
            type="button"
            disabled={disabled}
            className={styles.close}
            aria-label={copy.closeInspector}
            title={copy.closeInspector}
            onClick={onClose}
          >
            <CanvasToolIcon name="close" />
          </button>
        </div>
        <div className={styles.tabs} role="tablist" aria-label={title}>
          {tabs.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                if (node) buttons.current.set(item.id, node);
                else buttons.current.delete(item.id);
              }}
              id={`${id}-tab-${item.id}`}
              type="button"
              disabled={disabled}
              role="tab"
              className={styles.tab}
              aria-selected={item.id === activeTab}
              aria-controls={`${id}-panel-${item.id}`}
              tabIndex={item.id === activeTab ? 0 : -1}
              title={item.label}
              onClick={() => onTabChange(item.id)}
              onKeyDown={(event) => {
                let next: number;
                if (event.key === "Home") next = 0;
                else if (event.key === "End") next = tabs.length - 1;
                else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  const rtl = event.currentTarget.closest("[dir]")?.getAttribute("dir") === "rtl";
                  const direction = (event.key === "ArrowRight" ? 1 : -1) * (rtl ? -1 : 1);
                  next = (index + direction + tabs.length) % tabs.length;
                } else return;
                event.preventDefault();
                event.stopPropagation();
                const nextTab = tabs[next];
                if (!nextTab) return;
                onTabChange(nextTab.id);
                buttons.current.get(nextTab.id)?.focus();
              }}
            >
              {item.icon ? (
                <span className={styles.tabIcon} aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </header>
      <div className={styles.body}>
        {tabs.map((item) => (
          <div
            key={item.id}
            id={`${id}-panel-${item.id}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${item.id}`}
            hidden={!open || item.id !== activeTab}
            inert={!open || item.id !== activeTab}
            tabIndex={0}
            className={styles.panel}
          >
            {item.content}
          </div>
        ))}
      </div>
    </aside>
  );
}
