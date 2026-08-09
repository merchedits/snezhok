export function composerBottomPadding(safeAreaBottom: number, keyboardVisible: boolean): number {
  const keyboardGap = 8;
  const navigationGap = 16;
  return keyboardVisible ? keyboardGap : Math.max(navigationGap, safeAreaBottom + keyboardGap);
}
