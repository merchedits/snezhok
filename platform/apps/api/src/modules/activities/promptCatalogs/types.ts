export interface LocalizedText {
  ru: string;
  en: string;
}

export interface ChoicePrompt {
  id: string;
  left: LocalizedText;
  right: LocalizedText;
}
