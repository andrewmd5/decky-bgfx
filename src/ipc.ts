import { callable } from "@decky/api";
import { SessionStore } from "./SessionStore";
import type { State, Result } from "./protocol";

export * from "./protocol";
export const store = new SessionStore({
  getState: callable<[game: string | null], State>("get_state"),
  command: callable<[session: string, preset: number, cmd: string, args: Record<string, unknown>], Result>("command"),
});
