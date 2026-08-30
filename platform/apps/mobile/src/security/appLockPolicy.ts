export function shouldConcealApp(enabled: boolean, signedIn: boolean, appState: string): boolean {
  return enabled && signedIn && appState !== "active";
}
