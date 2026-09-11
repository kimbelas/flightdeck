// Framework-required default export (CODING-STANDARDS R11 exempts app/**/layout.tsx).
import type { JSX, ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Flightdeck',
  description: 'Control tower for every Claude Code session across both subscriptions',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
