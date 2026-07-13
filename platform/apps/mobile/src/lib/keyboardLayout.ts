export function composerBottomPadding(safeAreaBottom: number, keyboardVisible: boolean): number {
  return keyboardVisible ? 7 : Math.max(safeAreaBottom, 7);
}
