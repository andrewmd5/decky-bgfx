import {
  compatibilityDetail, compatibilityLabel,
  type Edit, type Result, type Session, type State, type Target,
} from "./protocol";

export interface SessionTransport {
  getState(game: string | null): Promise<State>;
  command(session: string, preset: number, cmd: string, args: Record<string, unknown>): Promise<Result>;
}

export interface PresetActivation {
  phase: "sending" | "preparing";
  session: string;
  index: number;
  name: string;
  after: number;
}

export interface ViewState {
  activation: PresetActivation | null;
  data: State | null;
  sessions: Session[];
  error: string;
  notice: string;
  connecting: boolean;
  connected: boolean;
}

export function isPreparing(view: ViewState): boolean {
  return view.activation !== null || view.data?.status.state === "compiling" ||
    !!view.data?.requested_preset;
}

export class SessionStore {
  private view: ViewState = { activation: null, data: null, sessions: [], error: "", notice: "", connecting: true, connected: false };
  private listeners = new Set<() => void>();
  private users = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private selected: string | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  private refreshTask?: Promise<void>;
  private stopped = false;
  private watchGeneration = 0;
  private connectionError = false;
  private pendingValues = new Map<string, { edit: Edit; result: Promise<boolean> }>();
  private readonly transport: SessionTransport;

  constructor(transport: SessionTransport) {
    this.transport = transport;
  }

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
      const data = await this.transport.getState(this.selected);
      if (!data.ok) {
        this.connectionError = true;
        if (!data.reconnecting) this.selected = null;
        this.update({ data: data.reconnecting ? this.view.data : null,
          activation: null, sessions: data.sessions ?? [], error: data.error ?? "Connection unavailable.",
          connecting: !!data.reconnecting, connected: false });
        return;
      }
      if (data.session !== this.view.data?.session || data.active?.token !== this.view.data?.active?.token) {
        this.pendingValues.clear();
        if (!this.view.activation) {
          this.update({ notice: "" });
        }
      }
      this.reconcileActivation(data);
      this.selected = data.game;
      this.update({ data, sessions: data.sessions, connecting: false, connected: true,
        ...(this.connectionError ? { error: "" } : {}) });
      this.connectionError = false;
    } catch (error) {
      this.connectionError = true;
      this.update({ activation: null, error: String(error), connecting: true, connected: false });
    }
  }
  refresh = (): Promise<void> => {
    if (this.stopped) {
      return Promise.resolve();
    }
    if (!this.refreshTask) {
      this.refreshTask = this.enqueue(() => this.read()).finally(() => {
        this.refreshTask = undefined;
      });
    }
    return this.refreshTask;
  };
  select = (game: string | null) => {
    this.pendingValues.clear();
    return this.enqueue(async () => {
      this.selected = game;
      this.update({ activation: null, data: null, error: "", notice: "", connecting: true, connected: false });
      await this.read();
    });
  };
  activate = (target: Target, index: number): Promise<boolean> => {
    const data = this.view.data;
    const preset = data?.presets.find(item => item.index === index);
    if (!data || !preset || this.view.activation || !this.view.connected || data.stale) {
      return Promise.resolve(false);
    }
    if (data.status.state === "compiling" || data.requested_preset) {
      return Promise.resolve(false);
    }
    if (preset.compatibility.status !== "Supported") {
      this.update({ error: compatibilityDetail(preset.compatibility) || compatibilityLabel(preset.compatibility) });
      return Promise.resolve(false);
    }
    if (data.active?.index === index && data.status.state !== "error") {
      return Promise.resolve(true);
    }

    const activation: PresetActivation = {
      phase: "sending", session: target.session, index, name: preset.name,
      after: data.updated_at,
    };
    this.pendingValues.clear();
    this.update({ activation, error: "", notice: "" });
    return this.enqueue(async () => {
      const accepted = await this.applyEdits(target, [{ cmd: "activate", args: { index } }]);
      if (this.view.activation === activation) {
        if (accepted) {
          this.update({ activation: { ...activation, phase: "preparing" } });
          await this.read();
        } else {
          this.update({ activation: null });
        }
      }
      return accepted;
    });
  };

  private reconcileActivation(data: State) {
    const activation = this.view.activation;
    if (!activation) {
      return;
    }
    if (data.session !== activation.session) {
      this.update({ activation: null, notice: "", error: "The game changed its renderer. Check the active preset." });
      return;
    }
    if (activation.phase === "sending" || data.stale || data.updated_at <= activation.after) {
      return;
    }
    if (data.status.state === "error") {
      this.update({ activation: null, notice: "", error: data.status.reason || "Could not prepare the preset." });
      return;
    }
    if (data.requested_preset || data.status.state === "compiling") {
      return;
    }
    if (data.active?.index === activation.index) {
      this.update({ activation: null, notice: `${activation.name} is ready` });
    } else if (data.active?.token !== this.view.data?.active?.token) {
      this.update({ activation: null, notice: "", error: "The active preset changed elsewhere." });
    }
  }

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
    if (this.stopped || !this.view.connected || data?.stale) return false;
    if (!data || data.session !== target.session || (data.active?.token ?? 0) !== target.preset) {
      this.update({ error: "Game or preset changed. Reopen its controls." });
      return false;
    }
    if (edits.length === 0) return true;
    this.update({ error: "", notice: "" });
    try {
      for (const edit of edits) {
        const result = await this.transport.command(target.session, target.preset, edit.cmd, edit.args ?? {});
        if (!result.ok) throw new Error(result.compatibility
          ? compatibilityDetail(result.compatibility) || compatibilityLabel(result.compatibility)
          : result.error ?? "The game did not apply the change.");
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
        if (this.users > 0 && !this.stopped && generation === this.watchGeneration) {
          let interval = 1000;
          if (isPreparing(this.view)) {
            interval = 250;
          }
          this.timer = setTimeout(poll, interval);
        }
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
