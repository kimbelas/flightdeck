// Framework-required default export (CODING-STANDARDS R11 exempts app/**/page.tsx).
//
// A server component carrying one route-segment export. A nonce cannot be stamped onto HTML
// generated at build time, so a nonce-based CSP (proxy.ts, SEC-UI-1) and static prerendering are
// mutually exclusive — and `export const dynamic` is ignored on a 'use client' module, which is
// why the view lives in its own file (RESEARCH.md F.5.1).
import type { JSX } from 'react';
import { DeckView } from './deck-view.tsx';

export const dynamic = 'force-dynamic';

export default function DeckPage(): JSX.Element {
  return <DeckView />;
}
