// frontend/src/components/ThemeProvider.tsx
import React, { createContext, useContext, useMemo } from "react";

type Theme = Record<string, never>;

const defaultTheme: Theme = {};

const ThemeContext = createContext<Theme>(defaultTheme);

export function useTheme() {
  return useContext(ThemeContext);
}

type Props = {
  theme?: Partial<Theme>;
  children: React.ReactNode;
};

function ThemeProvider({ theme, children }: Props) {
  const value = useMemo<Theme>(() => ({ ...defaultTheme, ...(theme || {}) }), [theme]);

  return (
    <ThemeContext.Provider value={value}>
      <div className="min-h-screen bg-theme-background text-theme-base transition-colors duration-200">{children}</div>
    </ThemeContext.Provider>
  );
}

export default ThemeProvider;
