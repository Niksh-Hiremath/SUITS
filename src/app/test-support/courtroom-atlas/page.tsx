import { notFound } from "next/navigation";

import { CourtroomVisualAtlas } from "@/components/courtroom/courtroom-visual-atlas";

export const dynamic = "force-dynamic";

export default function CourtroomAtlasPage() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.SUITS_ENABLE_VISUAL_ATLAS !== "1"
  ) {
    notFound();
  }

  return <CourtroomVisualAtlas />;
}
