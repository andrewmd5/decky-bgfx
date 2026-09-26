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
export interface Session { game: string; session: string; pid: number; app_id?: string }
export interface State extends Result, Session {
  protocol: number;
  stale: boolean;
  reconnecting?: boolean;
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
const getState = callable<[game: string | null], State>("get_state");
const command = callable<[session: string, preset: number, cmd: string, args: Record<string, unknown>], Result>("command");

interface ViewState {
  data: State | null;
  sessions: Session[];
  error: string;
  notice: string;
  connecting: boolean;
  connected: boolean;
}

class SessionStore {
  private view: ViewState = { data: null, sessions: [], error: "", notice: "", connecting: true, connected: false };
  private listeners = new Set<() => void>();
  private users = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private selected: string | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  private refreshing = false;
  private stopped = false;
  private watchGeneration = 0;
  private connectionError = false;
  private pendingValues = new Map<string, { edit: Edit; result: Promise<boolean> }>();
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
        if (!data.reconnecting) this.selected = null;
        this.update({ data: data.reconnecting ? this.view.data : null,
          sessions: data.sessions ?? [], error: data.error ?? "Connection unavailable.",
          connecting: !!data.reconnecting, connected: false });
        return;
      }
      if (data.session !== this.view.data?.session) this.pendingValues.clear();
      this.selected = data.game;
      this.update({ data, sessions: data.sessions, connecting: false, connected: true,
        ...(this.connectionError ? { error: "" } : {}) });
      this.connectionError = false;
    } catch (error) {
      this.connectionError = true;
      this.update({ error: String(error), connecting: true, connected: false });
    }
  }
  refresh = async () => {
    if (this.refreshing || this.stopped) return;
    this.refreshing = true;
    try { await this.enqueue(() => this.read()); }
    finally { this.refreshing = false; }
  };
  select = (game: string | null) => {
    this.pendingValues.clear();
    return this.enqueue(async () => {
      this.selected = game;
      this.update({ data: null, error: "", notice: "", connecting: true, connected: false });
      await this.read();
    });
  };
  setValue = (target: Target, edit: Edit): Promise<boolean> => {
    const key = JSON.stringify([target.session, target.preset, edit.cmd, edit.args?.effect, edit.args?.name]);
    const existing = this.pendingValues.get(key);
    if (existing) {
      existing.edit = edit;
      return existing.result;
    }
    const pending: { edit: Edit; result: Promise<boolean> } = {
      edit,
      result: this.enqueue(() => {
        if (this.pendingValues.get(key) === pending) this.pendingValues.delete(key);
        return this.applyEdits(target, [pending.edit]);
      }),
    };
    this.pendingValues.set(key, pending);
    return pending.result;
  };
  edit = (target: Target, edits: Edit[], notice = "") => {
    this.pendingValues.clear();
    return this.enqueue(() => this.applyEdits(target, edits, notice));
  };
  private async applyEdits(target: Target, edits: Edit[], notice = ""): Promise<boolean> {
    const data = this.view.data;
    if (this.stopped || !this.view.connected) return false;
    if (!data || data.session !== target.session || (data.active?.token ?? 0) !== target.preset) {
      this.update({ error: "Game or preset changed. Reopen its controls." });
      return false;
    }
    if (edits.length === 0) return true;
    this.update({ error: "", notice: "" });
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
    }
  }
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
    this.pendingValues.clear();
    this.listeners.clear();
  }
}
export const store = new SessionStore();
