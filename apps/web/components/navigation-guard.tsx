"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";

type Blocker = () => boolean;
interface NavigationGuard {
  register: (blocker: Blocker) => () => void;
  confirmNavigation: () => boolean;
}

const NavigationGuardContext = createContext<NavigationGuard | null>(null);

/** Scoped to editors that opt in; ordinary workspace navigation stays unchanged. */
export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const blockers = useRef(new Set<Blocker>());
  const register = useCallback((blocker: Blocker) => {
    blockers.current.add(blocker);
    return () => {
      blockers.current.delete(blocker);
    };
  }, []);
  const isBlocked = useCallback(() => [...blockers.current].some((blocker) => blocker()), []);
  const confirmNavigation = useCallback(
    () => !isBlocked() || window.confirm("Changes are not fully saved. Leave this editor anyway?"),
    [isBlocked],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!isBlocked()) return;
      event.preventDefault();
      // Legacy browsers require returnValue as well as preventDefault.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isBlocked]);
  const value = useMemo(() => ({ register, confirmNavigation }), [register, confirmNavigation]);
  return (
    <NavigationGuardContext.Provider value={value}>{children}</NavigationGuardContext.Provider>
  );
}

export function useNavigationBlocker(blocker: Blocker) {
  const guard = useContext(NavigationGuardContext);
  useEffect(() => guard?.register(blocker), [blocker, guard]);
}

const allowNavigation = () => true;

/** Check before programmatic routing or destructive actions such as signing out. */
export function useConfirmNavigation() {
  return useContext(NavigationGuardContext)?.confirmNavigation ?? allowNavigation;
}

export function GuardedLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
  const confirmNavigation = useConfirmNavigation();
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        if (!confirmNavigation()) {
          event.preventDefault();
          return;
        }
        onNavigate?.(event);
      }}
    />
  );
}
