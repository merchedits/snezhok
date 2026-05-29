import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import en from "./en.json";
import ru from "./ru.json";

export type Language = "en" | "ru";

const translations: Record<Language, Record<string, any>> = { en, ru };

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  language: "en",
  setLanguage: () => {},
  t: (key: string) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem("snezhok-lang");
    return (saved === "ru" || saved === "en") ? saved : "en";
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("snezhok-lang", lang);
  }, []);

  const t = useCallback((key: string): string => {
    const keys = key.split(".");
    let result: any = translations[language];
    for (const k of keys) {
      if (result && typeof result === "object" && k in result) {
        result = result[k];
      } else {
        // Fallback to English
        let fallback: any = translations["en"];
        for (const fk of keys) {
          if (fallback && typeof fallback === "object" && fk in fallback) {
            fallback = fallback[fk];
          } else {
            return key; // Return the key itself as last resort
          }
        }
        return typeof fallback === "string" ? fallback : key;
      }
    }
    return typeof result === "string" ? result : key;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}
