"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PopupNotCommunity from "@/components/register/PopupNotCommunity";

// Route DEMO — anteprima del popup ROSSO (not-community). Handlers stub.
export default function DemoNotCommunity() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <PopupNotCommunity
      loading={loading}
      onClose={() => router.push("/popup")}
      onRetry={() => {
        setLoading(true);
        setTimeout(() => setLoading(false), 1200);
      }}
    />
  );
}
