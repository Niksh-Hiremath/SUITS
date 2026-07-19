"use client";

import { useState, type FormEvent } from "react";

import type { HearingVoiceInputMode } from "@/lib/speech/hearing-policy";

const DEV_TYPED_INPUT_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_SUITS_DEV_TYPED_INPUT === "1";

type DeveloperFinalSubmitter = Readonly<{
  submitDeveloperFinal: (
    mode: HearingVoiceInputMode,
    text: string,
  ) => Promise<void>;
}>;

type DeveloperTypedInputProps = Readonly<{
  controller: DeveloperFinalSubmitter | null;
  mode: HearingVoiceInputMode;
  label: string;
  placeholder: string;
  disabled: boolean;
  minimumLength?: number;
  onFailure?: (message: string) => void;
}>;

export function DeveloperTypedInput({
  controller,
  mode,
  label,
  placeholder,
  disabled,
  minimumLength = 1,
  onFailure,
}: DeveloperTypedInputProps) {
  const [text, setText] = useState("");

  if (!DEV_TYPED_INPUT_ENABLED) return null;

  const normalized = text.trim();
  const unavailable =
    disabled || controller === null || normalized.length < minimumLength;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (unavailable || controller === null) return;
    void controller
      .submitDeveloperFinal(mode, normalized)
      .then(() => setText(""))
      .catch((cause: unknown) => {
        onFailure?.(
          cause instanceof Error
            ? cause.message
            : "The developer speech fallback could not be submitted.",
        );
      });
  }

  return (
    <form className="text-fallback" onSubmit={submit}>
      <label htmlFor={`developer-${mode}`}>{label}</label>
      <textarea
        disabled={disabled || controller === null}
        id={`developer-${mode}`}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        rows={mode === "closing" ? 5 : 3}
        value={text}
      />
      <button className="quiet-button" disabled={unavailable} type="submit">
        Submit developer transcript
      </button>
    </form>
  );
}
