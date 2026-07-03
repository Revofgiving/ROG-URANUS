"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PopupNeedRogSmall from "@/components/register/PopupNeedRogSmall";

// Route DEMO — anteprima del popup GIALLO (need-rog-small). Handlers stub.
export default function DemoNeedRogSmall() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <PopupNeedRogSmall
      loading={loading}
      onClose={() => router.push("/popup")}
      onRetry={() => {
        setLoading(true);
        setTimeout(() => setLoading(false), 1200);
      }}
    />
  );
}
