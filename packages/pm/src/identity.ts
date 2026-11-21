// t3code-pm: the fork desktop app's identity, so it installs and runs beside official T3 Code.
export const PM_DESKTOP_IDENTITY = {
  appId: "com.t3codepm.desktop",
  baseName: "T3 Code PM",
  productName: "T3 Code PM",
  scheme: "t3code-pm",
  devScheme: "t3code-pm-dev",
  /** Electron profile folders, with no legacy folder to migrate from. Separate folders also
   * separate the single-instance lock. */
  userDataNames: {
    development: { current: "t3code-pm-dev", legacy: "t3code-pm-dev" },
    production: { current: "t3code-pm", legacy: "t3code-pm" },
  },
  /** The shell command, so it never takes over the official app's `t3`. */
  cliName: "t3-pm",
  linuxExecutableName: "t3code-pm",
  linuxWindowClass: "com.t3codepm.T3CodePM",
} as const;

declare const __T3CODE_PM_DESKTOP_IDENTITY__: boolean | undefined;

/**
 * The desktop bundle defines this (apps/desktop/vite.config.ts); Vitest runs without the bundler,
 * so upstream's tests keep pinning upstream's identity while every fork build uses ours.
 */
const identityOn =
  typeof __T3CODE_PM_DESKTOP_IDENTITY__ !== "undefined" && __T3CODE_PM_DESKTOP_IDENTITY__ === true;

/** The fork's value in a fork desktop bundle, upstream's otherwise. */
export const pmDesktop = <T>(fork: T, upstream: T): T => (identityOn ? fork : upstream);

/** Desktop window origins the server trusts: the official app's, so it can still connect, and ours. */
export const PM_TRUSTED_DESKTOP_ORIGINS = [
  "t3code://app",
  "t3code-dev://app",
  `${PM_DESKTOP_IDENTITY.scheme}://app`,
  `${PM_DESKTOP_IDENTITY.devScheme}://app`,
] as const;
