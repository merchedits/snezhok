export interface AppDialogAction {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

export function normalizeDialogActions(actions: AppDialogAction[] | undefined, okLabel: string): AppDialogAction[] {
  return actions?.length ? actions : [{ text: okLabel }];
}

interface DialogIdentity {
  title: string;
  message?: string;
}

/** Prevents rapid duplicate failures from building an unbounded modal queue. */
export function enqueueUniqueDialog<T extends DialogIdentity>(current: readonly T[], request: T, maximum = 4): T[] {
  if (current.some((item) => item.title === request.title && item.message === request.message)) return [...current];
  if (current.length >= maximum) return [...current];
  return [...current, request];
}
