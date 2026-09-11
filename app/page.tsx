// Framework-required default export (CODING-STANDARDS R11 exempts app/**/page.tsx).
import type { JSX } from 'react';
import Link from 'next/link';

export default function Home(): JSX.Element {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 16, margin: '0 0 12px' }}>Flightdeck</h1>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li>
          <Link href="/deck">The deck — sessions and terminal panes</Link>
        </li>
        <li style={{ color: 'var(--dim)', marginTop: 6 }}>
          <Link href="/spike/xterm">P0-T6 — xterm.js 6 harness</Link>
        </li>
      </ul>
    </main>
  );
}
