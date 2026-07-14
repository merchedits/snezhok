export function composerBottomPadding(safeAreaBottom: number, keyboardVisible: boolean): number {
  const composerGap = 7;
  return keyboardVisible ? composerGap : Math.max(composerGap, safeAreaBottom + composerGap);
}
