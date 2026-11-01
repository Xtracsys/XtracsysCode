import { useCallback, useState } from "react";
import { api } from "../api";

/** P4: accent presets applied via CSS custom property, persisted in settings. */
export const ACCENTS: { name: string; value: string }[] = [
  { name: "Ember", value: "#e0784f" },
  { name: "Moss", value: "#6bbf74" },
  { name: "Cobalt", value: "#5b8dd9" },
  { name: "Amethyst", value: "#9a6bd9" },
  { name: "Gold", value: "#d9a441" },
  { name: "Rose", value: "#d95c8c" },
  { name: "Teal", value: "#4fb8b0" },
  { name: "Slate", value: "#8a93a5" },
];

export function useAppearance() {
  const [accent, setAccent] = useState<string>("#e0784f");
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  const [init, setInit] = useState(false);

  const apply = useCallback((a: string, rm: boolean) => {
    document.documentElement.style.setProperty("--accent", a);
    document.documentElement.dataset.reduceMotion = rm ? "true" : "false";
  }, []);

  /** Called by App once settings arrive. */
  const initFrom = useCallback(
    (appearance?: { accent: string; reduceMotion: boolean }) => {
      if (init) return;
      setInit(true);
      const a = appearance?.accent || ACCENTS[0].value;
      const rm = appearance?.reduceMotion === true;
      setAccent(a);
      setReduceMotion(rm);
      apply(a, rm);
    },
    [apply, init],
  );

  const set = useCallback(
    (patch: { accent?: string; reduceMotion?: boolean }) => {
      const a = patch.accent ?? accent;
      const rm = patch.reduceMotion ?? reduceMotion;
      setAccent(a);
      setReduceMotion(rm);
      apply(a, rm);
      void api.setSettings({ appearance: { accent: a, reduceMotion: rm } });
    },
    [accent, reduceMotion, apply],
  );

  return { accent, reduceMotion, initFrom, set };
}
