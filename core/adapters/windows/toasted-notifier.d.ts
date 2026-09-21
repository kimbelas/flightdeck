// The slice of `toasted-notifier` this codebase uses — P6-T3.
//
// The package ships no types and DefinitelyTyped has none, so the alternative to this file is an
// `any` at the boundary, which is banned (CODING-STANDARDS §11) and would be the wrong shape of
// wrong besides: an untyped import is not a gap in our knowledge, it is a contract we have to
// state. What is declared here is what the adapter actually calls and nothing else — a wider
// declaration would be this file guessing at a library rather than pinning a use.
//
// **`export =`, and a named import is not merely unidiomatic here — it does not work.** The package
// is CommonJS and its export is a live `WindowsToaster` INSTANCE, not a namespace: `notify` is a
// method that reads `this.options`, so both `import { notify }` and a destructured `const { notify }`
// are wrong, the first at load and the second at call. Node's ESM loader refuses the first outright
// with "does not provide an export named 'notify'" — and vitest's loader does not, which is how the
// unit suite passed while core would not boot (RESEARCH.md G.52).
declare module 'toasted-notifier' {
  /** Every field `WindowsToastNotifier` sets. The library accepts many more; we pass these. */
  interface ToastOptions {
    readonly title: string;
    readonly message: string;
    /** Seconds the toast stays on screen before Windows moves it to the Action Center. */
    readonly timeout?: number;
    /** Whether to keep the child alive waiting for a click. Always `false` here — see the adapter. */
    readonly wait?: boolean;
  }

  interface ToastedNotifier {
    /**
     * The callback fires when the toast RESOLVES, not when it appears — measured at 3.8 s for a
     * toast that timed out (RESEARCH.md G.51). Nothing here waits for it.
     */
    notify(options: ToastOptions, done?: (error: Error | null, response?: string) => void): unknown;
  }

  const notifier: ToastedNotifier;
  export = notifier;
}
