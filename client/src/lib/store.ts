
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ApiKeyStore {
  keys: {
    openai: string;
    anthropic: string;
    grok: string;
    perplexity: string;
    deepseek: string;
  };
  setKey: (provider: keyof ApiKeyStore["keys"], key: string) => void;
}

export const useApiKeys = create<ApiKeyStore>()(
  persist(
    (set) => ({
      keys: {
        openai: import.meta.env.VITE_OPENAI_API_KEY || "",
        anthropic: import.meta.env.VITE_ANTHROPIC_API_KEY || "",
        grok: import.meta.env.VITE_GROK_API_KEY || "",
        perplexity: import.meta.env.VITE_PERPLEXITY_API_KEY || "",
        deepseek: import.meta.env.VITE_DEEPSEK_API_KEY || "",
      },
      setKey: (provider, key) =>
        set((state) => ({
          keys: { ...state.keys, [provider]: key },
        })),
    }),
    {
      name: "llm-api-keys",
    }
  )
);
