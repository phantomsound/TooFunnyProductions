// frontend/src/components/ThemeProvider.tsx
import React, { createContext, useContext, useMemo } from "react";

type Theme = {
  bg: string;        // page background
  card: string;      // card background
  text: string;      // base text color
  accent: string;    // accent color (e.g., buttons)
};

const defaultTheme: Theme = {
  bg: "bg-neutral-900",      // near-black
  card: "bg-neutral-800",    // dark gray
  text: "text-white",
  accent: "text-yellow-400",
};

const ThemeContext = createContext<Theme>(defaultTheme);

export function useTheme() {
  return useContext(ThemeContext);
}

type Props = {
  theme?: Partial<Theme>;
  children: React.ReactNode;
};

function ThemeProvider({ theme, children }: Props) {
  const value = useMemo<Theme>(
    () => ({ ...defaultTheme, ...(theme || {}) }),
    [theme]
  );

  return (
    <ThemeContext.Provider value={value}>
      <div className={`${value.bg} ${value.text} min-h-screen`}>{children}</div>
    </ThemeContext.Provider>
  );
}

export default ThemeProvider;
