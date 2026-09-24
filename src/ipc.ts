import { callable } from "@decky/api";

export interface Result { ok: boolean; error?: string }
export interface Parameter {
  name: string;
  label: string;
  description: string;
  type: "float" | "int" | "bool" | "texture";
  value: number | string;
  default: number | string;
  min: number;
  max: number;
  step: number;
  labels: string[];
}
export interface EffectEntry {
  name: string;
  can_scale: boolean;
  scaling: string;
  multiplier_parameter?: string;
  params: Parameter[];
}
export interface Session { session: string; pid: number; app_id?: string }
export interface State extends Result, Session {
  protocol: number;
  stale: boolean;
  updated_at: number;
  sessions: Session[];
  requested_preset?: string;
  dirty: boolean;
  presets: { name: string; description: string; index: number; is_favorite: boolean; chain_count: number }[];
  active: { token: number; index: number; name: string; show_hud: boolean; effects: EffectEntry[] } | null;
  status: {
    state: string; reason?: string; frame_generation: boolean; multiplier: number;
    source_fps: number; generated_fps: number; submitted_fps: number; failed_presents: number;
    width: number; height: number; effect: string; pass: number; pass_count: number;
  };
}
export interface Target { session: string; preset: number }
export interface Edit { cmd: string; args?: Record<string, unknown> }
export const targetOf = (state: State): Target => ({ session: state.session, preset: state.active?.token ?? 0 });
const getState = callable<[session: string | null], State>("get_state");
const command = callable<[session: string, preset: number, cmd: string, args: Record<string, unknown>], Result>("command");

interface ViewState {
  data: State | null;
  sessions: Session[];
  error: string;
  notice: string;
  busy: boolean;
  connecting: boolean;
}

class SessionStore {
  private view: ViewState = { data: null, sessions: [], error: "", notice: "", busy: false, connecting: true };
  private listeners = new Set<() => void>();
  private users = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private selected: string | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  private refreshing = false;
  private stopped = false;
  private watchGeneration = 0;
  private connectionError = false;
  snapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(change: Partial<ViewState>) {
    if (this.stopped) return;
    this.view = { ...this.view, ...change };
    for (const listener of this.listeners) listener();
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(work);
    this.serial = next.catch(() => {});
    return next;
  }
  private async read() {
    try {
      const data = await getState(this.selected);
      if (!data.ok) {
        this.connectionError = true;
        this.update({ data: null, sessions: data.sessions ?? [], error: data.error ?? "Connection unavailable.", connecting: false });
        return;
      }
      this.selected = data.session;
      this.update({ data, sessions: data.sessions, connecting: false,
        ...(this.connectionError ? { error: "" } : {}) });
      this.connectionError = false;
    } catch (error) {
      this.connectionError = true;
      this.update({ data: null, error: String(error), connecting: false });
    }
  }
  refresh = async () => {
    if (this.refreshing || this.stopped) return;
    this.refreshing = true;
    try { await this.enqueue(() => this.read()); }
    finally { this.refreshing = false; }
  };
  select = (session: string | null) => this.enqueue(async () => {
    this.selected = session;
    this.update({ data: null, error: "", notice: "", connecting: true });
    await this.read();
  });
  edit = (target: Target, edits: Edit[], notice = "") =>
    this.enqueue(async (): Promise<boolean> => {
      const data = this.view.data;
      if (!data || data.session !== target.session || data.active?.token !== target.preset) {
        this.update({ error: "Game or preset changed. Reopen its controls." });
        return false;
      }
      this.update({ busy: true, error: "", notice: "" });
      try {
        for (const edit of edits) {
          const result = await command(target.session, target.preset, edit.cmd, edit.args ?? {});
          if (!result.ok) throw new Error(result.error ?? "The game did not apply the change.");
        }
        this.update({ notice });
        await this.read();
        return true;
      } catch (error) {
        this.update({ error: error instanceof Error ? error.message : String(error) });
        await this.read();
        return false;
      } finally { this.update({ busy: false }); }
    });
  watch() {
    this.users++;
    if (this.users === 1) {
      const generation = ++this.watchGeneration;
      const poll = async () => {
        await this.refresh();
        if (this.users > 0 && !this.stopped && generation === this.watchGeneration)
          this.timer = setTimeout(poll, 1000);
      };
      void poll();
    }
    return () => {
      this.users--;
      if (this.users === 0) { this.watchGeneration++; clearTimeout(this.timer); }
    };
  }
  dispose() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.listeners.clear();
  }
}
export const store = new SessionStore();
