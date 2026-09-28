// Which account each project starts on, and whether it is locked there — P10-T2.
//
// A fact about this browser, so it lives in `localStorage` beside the layout, the view and the
// current project (`use-deck-view.ts`), and is read after mount so the first client render matches
// the server's. What it guards is a habit rather than a secret: a lock that is lost to a cleared
// profile falls back to the toggle, which still shows the account before anything starts.
//
// The stored value is untrusted like anything read back from storage: `parseMemories` (in the view
// model's file, so it is tested without a DOM) keeps an entry only when it is well-formed.
import { useCallback, useEffect, useState } from 'react';
import type { SubscriptionId } from '../../contracts/session.ts';
import {
  parseMemories,
  type AccountMemories,
  type AccountMemory,
} from './start-launcher-view-model.ts';

const MEMORY_KEY = 'flightdeck.start-accounts';

export interface StartMemory {
  readonly memory: AccountMemories;
  /** Remembers the account a project was started on, keeping its lock as it was. */
  readonly remember: (projectKey: string, account: SubscriptionId) => void;
  /** Locks a project to an account, or unlocks it. */
  readonly lock: (projectKey: string, account: SubscriptionId, locked: boolean) => void;
}

export function useStartMemory(): StartMemory {
  const [memory, setMemory] = useState<AccountMemories>({});

  useEffect(() => {
    setMemory(parseMemories(read()));
  }, []);

  const update = useCallback(
    (projectKey: string, next: (held?: AccountMemory) => AccountMemory) => {
      setMemory((current) => {
        const updated = { ...current, [projectKey]: next(current[projectKey]) };
        write(JSON.stringify(updated));
        return updated;
      });
    },
    [],
  );

  const remember = useCallback(
    (projectKey: string, account: SubscriptionId) => {
      update(projectKey, (held) => ({ account, locked: held?.locked === true }));
    },
    [update],
  );

  const lock = useCallback(
    (projectKey: string, account: SubscriptionId, locked: boolean) => {
      update(projectKey, () => ({ account, locked }));
    },
    [update],
  );

  return { memory, remember, lock };
}

// Storage can be missing or throw — a private window, blocked site data. Either way the launcher
// draws its defaults and nothing is remembered.
function read(): string | undefined {
  try {
    return window.localStorage.getItem(MEMORY_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(value: string): void {
  try {
    window.localStorage.setItem(MEMORY_KEY, value);
  } catch {
    // Not remembered; the account on screen is still the one that will be used.
  }
}
