import { compatibilityMessages } from "./locales/en";

export interface Result { ok: boolean; error?: string; compatibility?: Compatibility }
interface ParameterBase {
  name: string;
  label: string;
  description: string;
}
export interface NumericParameter extends ParameterBase {
  type: "float" | "int" | "bool";
  value: number;
  default: number;
  min: number;
  max: number;
  step: number;
  labels: string[];
}
export interface TextureParameter extends ParameterBase {
  type: "texture";
  value: string;
  default: string;
}
export type Parameter = NumericParameter | TextureParameter;
export interface EffectEntry {
  name: string;
  can_scale: boolean;
  scaling: string;
  multiplier_parameter?: string;
  params: Parameter[];
}
export interface Session {
  game: string; session: string; pid: number; app_id?: string;
  presentation?: { path: "application" | "capture"; surface: string; has_presented: boolean; last_presented_at?: number; last_effect_presented_at?: number };
}
export interface Compatibility {
  status: keyof typeof compatibilityMessages;
  effect: string;
  diagnostic: string;
}
export const compatibilityLabel = (support: Compatibility): string =>
  compatibilityMessages[support.status]?.label ?? "Unknown compatibility status";
export const compatibilityDetail = (support: Compatibility): string => {
  const message = compatibilityMessages[support.status]?.description
    ?? "Update BGFX and the Decky plugin together.";
  if (!message) return "";
  return support.effect ? `${support.effect}: ${message}` : message;
};
export interface State extends Result, Session {
  protocol: number;
  stale: boolean;
  reconnecting?: boolean;
  updated_at: number;
  sessions: Session[];
  requested_preset?: string;
  dirty: boolean;
  compatibility_adapter: string;
  presets: { name: string; path: string; description: string; index: number; is_favorite: boolean; chain_count: number;
    compatibility: Compatibility }[];
  active: { token: number; index: number; name: string; path: string; show_hud: boolean; effects: EffectEntry[];
    compatibility: Compatibility } | null;
  status: {
    state: string; reason?: string; effects_active?: boolean; frame_generation: boolean; multiplier: number;
    source_fps: number; generated_fps: number; submitted_fps: number; failed_presents: number;
    width: number; height: number; effect: string; pass: number; pass_count: number;
  };
}
export interface Target { session: string; preset: number }
export interface Edit { cmd: string; args?: Record<string, unknown> }
export const targetOf = (state: State): Target => ({ session: state.session, preset: state.active?.token ?? 0 });
