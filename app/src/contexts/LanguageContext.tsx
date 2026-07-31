import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type AppLanguage =
  | 'English'
  | 'Hindi'
  | 'Telugu'
  | 'Tamil'
  | 'Kannada'
  | 'Malayalam'
  | 'Marathi'
  | 'Gujarati'
  | 'Punjabi'
  | 'Bengali'
  | 'Odia'
  | 'Assamese'
  | 'Urdu'
  | 'Sanskrit'
  | 'Nepali'
  | 'Konkani'
  | 'Sindhi'
  | 'Kashmiri'
  | 'Maithili'
  | 'Dogri'
  | 'Manipuri'
  | 'Santali'
  | 'Bodo';

export const languageMeta: Record<AppLanguage, { code: string; nativeName: string }> = {
  English: { code: 'en', nativeName: 'English' },
  Hindi: { code: 'hi', nativeName: 'Hindi (Hindi)' },
  Telugu: { code: 'te', nativeName: 'Telugu (Telugu)' },
  Tamil: { code: 'ta', nativeName: 'Tamil (Tamil)' },
  Kannada: { code: 'kn', nativeName: 'Kannada (Kannada)' },
  Malayalam: { code: 'ml', nativeName: 'Malayalam (Malayalam)' },
  Marathi: { code: 'mr', nativeName: 'Marathi (Marathi)' },
  Gujarati: { code: 'gu', nativeName: 'Gujarati (Gujarati)' },
  Punjabi: { code: 'pa', nativeName: 'Punjabi (Punjabi)' },
  Bengali: { code: 'bn', nativeName: 'Bengali (Bangla)' },
  Odia: { code: 'or', nativeName: 'Odia (Odia)' },
  Assamese: { code: 'as', nativeName: 'Assamese (Assamese)' },
  Urdu: { code: 'ur', nativeName: 'Urdu (Urdu)' },
  Sanskrit: { code: 'sa', nativeName: 'Sanskrit (Sanskrit)' },
  Nepali: { code: 'ne', nativeName: 'Nepali (Nepali)' },
  Konkani: { code: 'gom', nativeName: 'Konkani (Konkani)' },
  Sindhi: { code: 'sd', nativeName: 'Sindhi (Sindhi)' },
  Kashmiri: { code: 'ks', nativeName: 'Kashmiri (Kashmiri)' },
  Maithili: { code: 'mai', nativeName: 'Maithili (Maithili)' },
  Dogri: { code: 'doi', nativeName: 'Dogri (Dogri)' },
  Manipuri: { code: 'mni', nativeName: 'Manipuri (Meitei)' },
  Santali: { code: 'sat', nativeName: 'Santali (Santali)' },
  Bodo: { code: 'brx', nativeName: 'Bodo (Bodo)' },
};

export const availableLanguages = Object.keys(languageMeta) as AppLanguage[];

type TranslationMap = Record<string, string>;

const translations: Partial<Record<AppLanguage, TranslationMap>> = {
  English: {
    settings: 'Settings',
    preferences: 'Preferences',
    preferredLanguage: 'Preferred Language',
    whatsappAlerts: 'WhatsApp Alerts',
    weeklyDigest: 'Weekly Financial Digest',
    savePreferences: 'Save Preferences',
    institutionSettings: 'Institution Settings',
    autoAuditAlerts: 'Auto Audit Alerts',
    grantApproval2FA: 'Grant Approval 2FA',
    saveSettings: 'Save Settings',
    languageUpdated: 'Language updated',
  },
  Hindi: {
    settings: 'सेटिंग्स',
    preferences: 'प्राथमिकताएं',
    preferredLanguage: 'पसंदीदा भाषा',
    whatsappAlerts: 'व्हाट्सऐप अलर्ट',
    weeklyDigest: 'साप्ताहिक वित्तीय सारांश',
    savePreferences: 'प्राथमिकताएं सहेजें',
    institutionSettings: 'संस्था सेटिंग्स',
    autoAuditAlerts: 'ऑटो ऑडिट अलर्ट',
    grantApproval2FA: 'ग्रांट अप्रूवल 2FA',
    saveSettings: 'सेटिंग्स सहेजें',
    languageUpdated: 'भाषा अपडेट हो गई',
  },
  Telugu: {
    settings: 'సెట్టింగ్స్',
    preferences: 'అభిరుచులు',
    preferredLanguage: 'ఇష్టమైన భాష',
    whatsappAlerts: 'వాట్సాప్ అలర్ట్స్',
    weeklyDigest: 'వారాంత ఆర్థిక సారాంశం',
    savePreferences: 'అభిరుచులను సేవ్ చేయండి',
    institutionSettings: 'సంస్థ సెట్టింగ్స్',
    autoAuditAlerts: 'ఆటో ఆడిట్ అలర్ట్స్',
    grantApproval2FA: 'గ్రాంట్ ఆమోదం 2FA',
    saveSettings: 'సెట్టింగ్స్ సేవ్ చేయండి',
    languageUpdated: 'భాష నవీకరించబడింది',
  },
};

interface LanguageContextType {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
  languages: AppLanguage[];
  getLanguageLabel: (lang: AppLanguage) => string;
  t: (key: string, fallback?: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function getInitialLanguage(): AppLanguage {
  const saved = localStorage.getItem('saheli-language');
  if (saved && availableLanguages.includes(saved as AppLanguage)) {
    return saved as AppLanguage;
  }
  return 'English';
}

function getCachedMachineTranslations(): Record<string, string> {
  try {
    const raw = localStorage.getItem('saheli-machine-translations');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function setCachedMachineTranslations(cache: Record<string, string>) {
  try {
    localStorage.setItem('saheli-machine-translations', JSON.stringify(cache));
  } catch {
    // Ignore storage write failures.
  }
}

async function translateTextViaSarvam(text: string, targetCode: string): Promise<string | null> {
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        sourceLanguageCode: 'en',
        targetLanguageCode: targetCode,
      }),
    });

    if (!res.ok) {
      return null;
    }

    const json = await res.json() as { data?: { translatedText?: string; provider?: string; warning?: string } };
    return json?.data?.translatedText?.trim() || null;
  } catch {
    return null;
  }
}

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<AppLanguage>(getInitialLanguage);
  const [machineCache, setMachineCache] = useState<Record<string, string>>(getCachedMachineTranslations);
  const [cacheVersion, setCacheVersion] = useState(0);
  const pendingRequestsRef = useRef<Set<string>>(new Set());

  const setLanguage = (lang: AppLanguage) => {
    setLanguageState(lang);
    localStorage.setItem('saheli-language', lang);
    document.documentElement.lang = languageMeta[lang].code;
  };

  const queueMachineTranslation = (lang: AppLanguage, key: string, sourceText: string) => {
    if (lang === 'English' || !sourceText?.trim()) {
      return;
    }

    const code = languageMeta[lang].code;
    const cacheKey = `${lang}::${key}`;
    if (machineCache[cacheKey] || pendingRequestsRef.current.has(cacheKey)) {
      return;
    }

    pendingRequestsRef.current.add(cacheKey);
    translateTextViaSarvam(sourceText, code)
      .then((translated) => {
        if (!translated) {
          return;
        }
        setMachineCache((prev) => {
          const next = { ...prev, [cacheKey]: translated };
          setCachedMachineTranslations(next);
          return next;
        });
        setCacheVersion((v) => v + 1);
      })
      .finally(() => {
        pendingRequestsRef.current.delete(cacheKey);
      });
  };

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      languages: availableLanguages,
      getLanguageLabel: (lang: AppLanguage) => languageMeta[lang].nativeName,
      t: (key: string, fallback?: string) => {
        const local = translations[language]?.[key];
        if (local) {
          return local;
        }

        const englishMap = translations.English || {};
        const baseText = englishMap[key] || fallback || key;
        if (language === 'English') {
          return baseText;
        }

        const cacheKey = `${language}::${key}`;
        const fromMachineCache = machineCache[cacheKey];
        if (fromMachineCache) {
          return fromMachineCache;
        }

        queueMachineTranslation(language, key, baseText);
        return baseText;
      },
    }),
    [language, machineCache, cacheVersion],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return ctx;
};
