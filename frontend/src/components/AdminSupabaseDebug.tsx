import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const AdminSupabaseDebug: React.FC = () => {
  const [status, setStatus] = useState<{
    url?: string;
    keyLoaded?: boolean;
    canSelect?: boolean;
    data?: any;
    error?: string;
  }>({});

  useEffect(() => {
    const testConnection = async () => {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

      let debug: any = {
        url,
        keyLoaded: !!key,
      };

      // 🔍 Step 1 — try simple select
      const { data, error } = await supabase.from("settings").select("*").limit(1);

      if (error) {
        debug.error = error.message || JSON.stringify(error);
        debug.canSelect = false;
      } else {
        debug.canSelect = true;
        debug.data = data;
      }

      setStatus(debug);
    };

    testConnection();
  }, []);

  return (
    <div className="bg-gray-900 text-white p-4 rounded-lg mt-6 shadow-lg">
      <h2 className="text-lg font-bold mb-2">🔧 Supabase Connection Debug</h2>
      <pre className="bg-black p-3 rounded text-sm overflow-auto max-h-64">
        {JSON.stringify(status, null, 2)}
      </pre>
      {!status.keyLoaded && (
        <p className="text-red-400 mt-2">
          ❌ Environment variable <code>VITE_SUPABASE_ANON_KEY</code> not loaded!
        </p>
      )}
      {status.error && (
        <p className="text-red-400 mt-2">
          ⚠️ {status.error}
        </p>
      )}
      {status.canSelect && (
        <p className="text-green-400 mt-2">
          ✅ Successfully fetched settings table! (connection authorized)
        </p>
      )}
    </div>
  );
};

export default AdminSupabaseDebug;
