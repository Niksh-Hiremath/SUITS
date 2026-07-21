import type { Metadata } from "next";

import { PreflightClient } from "./preflight-client";

export const metadata: Metadata = {
  title: "System preflight — SUITS",
  description:
    "Check the private session, durable court record, GPT-5.6 models, microphone, and configured SUITS speech runtime before a fictional hearing.",
};

export default function PreflightPage() {
  return <PreflightClient />;
}
