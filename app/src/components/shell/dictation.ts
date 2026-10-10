"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ditado pela Web Speech API do navegador (pt-BR), para falar com o Concierge. O áudio é
 * reconhecido pelo próprio navegador (no Chrome, pelo serviço de voz do Google); o Hub só
 * recebe o texto. Sem suporte no navegador, o botão do microfone não aparece.
 */

type Alternative = { transcript: string };
type SpeechResult = ArrayLike<Alternative> & { isFinal: boolean };

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<SpeechResult>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionCtor = new () => Recognition;

/** O reconhecimento de voz do navegador, se houver. */
export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed":
    "O navegador não deixou usar o microfone. Libere o microfone para este site e tente de novo.",
  "service-not-allowed":
    "O navegador não deixou usar o ditado. Libere o microfone para este site e tente de novo.",
  "no-speech": "Não ouvi nada. Clique no microfone e fale de novo.",
  "audio-capture": "Nenhum microfone encontrado.",
  network: "O ditado do navegador precisa de internet.",
};

export function useDictation({
  onText,
  onFinal,
}: {
  /** Texto parcial, enquanto a pessoa fala. */
  onText: (text: string) => void;
  /** Texto final, quando a pessoa para de falar. */
  onFinal: (text: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Recognition | null>(null);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || current.current) return;
    const recognition = new Ctor();
    recognition.lang = "pt-BR";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    let finalText = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += text;
        else interim += text;
      }
      onText(`${finalText}${interim}`.replace(/\s+/g, " ").trim());
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted") {
        setError(ERRORS[event.error] ?? "O ditado parou. Tente de novo.");
      }
    };
    recognition.onend = () => {
      current.current = null;
      setListening(false);
      const text = finalText.replace(/\s+/g, " ").trim();
      if (text) onFinal(text);
    };
    current.current = recognition;
    setError(null);
    setListening(true);
    try {
      recognition.start();
    } catch {
      current.current = null;
      setListening(false);
      setError("O ditado não começou. Tente de novo.");
    }
  }, [onText, onFinal]);

  const stop = useCallback(() => current.current?.stop(), []);

  // Fechou a janela no meio do ditado: para de ouvir.
  useEffect(() => () => current.current?.abort(), []);

  return { listening, error, start, stop };
}
