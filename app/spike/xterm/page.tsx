// Framework-required default export (CODING-STANDARDS R11 exempts app/**/page.tsx).
//
// A server component whose only job is to carry the segment config: a nonce cannot be stamped onto
// HTML generated at build time, so a nonce-based CSP (middleware.ts, SEC-UI-1) and static
// prerendering are mutually exclusive. `export const dynamic` is a route-segment export and is
// ignored on a 'use client' module, so the harness had to move to its own file for this one line
// to have any effect (RESEARCH.md F.5.1).
import type { JSX } from 'react';
import { XtermHarness } from './xterm-harness.tsx';

export const dynamic = 'force-dynamic';

export default function XtermSpikePage(): JSX.Element {
  return <XtermHarness />;
}
