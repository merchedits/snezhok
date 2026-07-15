export interface AppDialogAction {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

export function normalizeDialogActions(actions: AppDialogAction[] | undefined, okLabel: string): AppDialogAction[] {
  return actions?.length ? actions : [{ text: okLabel }];
}
