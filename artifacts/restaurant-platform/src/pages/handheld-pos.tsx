import { useEffect } from "react";
import PosPage from "@/pages/pos";
import { Smartphone } from "lucide-react";

export default function HandheldPosPage() {
  useEffect(() => {
    document.documentElement.classList.add("handheld-pos-mode");
    return () => {
      document.documentElement.classList.remove("handheld-pos-mode");
    };
  }, []);

  return (
    <div className="handheld-pos-root">
      <div className="hidden lg:flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-900 text-sm text-blue-900 dark:text-blue-200">
        <Smartphone className="h-4 w-4" />
        <span>
          <strong>Handheld POS</strong> — tableside ordering mode. For phone-sized devices, waiters should use the TableTrack mobile app.
        </span>
      </div>
      <PosPage />
    </div>
  );
}
