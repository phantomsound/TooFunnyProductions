import React from "react";
import { useSettings } from "../hooks/useSettings";

const Footer: React.FC = () => {
  const { settings } = useSettings();

  return (
    <footer className="bg-brandDark text-white py-6 text-center">
      <p className="text-sm">
        {settings?.footer?.text || "© 2025 Too Funny Productions. All rights reserved."}
      </p>
    </footer>
  );
};

export default Footer;
