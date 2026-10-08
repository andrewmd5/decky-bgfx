import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionStore, type SessionTransport } from "../src/SessionStore";
import { targetOf, type Result, type State } from "../src/protocol";

const supported = { status: "Supported", effect: "", diagnostic: "" } as const;
function snapshot(): State {
  return {
    ok: true, protocol: 4, session: "renderer", pid: 1, app_id: "123", game: "app:123",
    stale: false, updated_at: 100, sessions: [], dirty: false, compatibility_adapter: "GPU",
    presets: [0, 1].map(index => ({
      index, name: index === 0 ? "Original" : "New preset", description: "",
      is_favorite: false, chain_count: 1, compatibility: supported,
    })),
    active: { token: 1, index: 0, name: "Original", effects: [], show_hud: false, compatibility: supported },
    status: {
      state: "active", frame_generation: false, multiplier: 1, source_fps: 60, generated_fps: 0,
      submitted_fps: 60, failed_presents: 0, width: 1280, height: 800, effect: "", pass: 0, pass_count: 0,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function setup() {
  let state = snapshot();
  let result: Promise<Result> = Promise.resolve({ ok: true });
  let calls = 0;
  const transport: SessionTransport = {
    async getState() { return structuredClone(state); },
    command() { calls++; return result; },
  };
  const store = new SessionStore(transport);
  await store.refresh();
  const target = targetOf(state);
  return {
    store, target, calls: () => calls,
    state: () => state,
    setState(value: State) { state = value; },
    reply(value: Promise<Result>) { result = value; },
    ready() {
      state.updated_at++;
      state.requested_preset = undefined;
      state.status.state = "active";
      state.active = { ...state.active!, token: 2, index: 1, name: "New preset" };
    },
  };
}

test("selection is visible immediately, before the queued command responds", async () => {
  const h = await setup();
  const response = deferred<Result>();
  h.reply(response.promise);
  const applying = h.store.activate(h.target, 1);
  assert.equal(h.store.snapshot().activation?.phase, "sending");
  assert.equal(h.store.snapshot().activation?.name, "New preset");
  response.resolve({ ok: true });
  await applying;
  assert.equal(h.store.snapshot().activation?.phase, "preparing");
  assert.equal(h.store.snapshot().notice, "");
});

test("acceptance and an early active-preset change do not mean pipelines are ready", async () => {
  const h = await setup();
  h.ready();
  h.state().status.state = "compiling";
  await h.store.activate(h.target, 1);
  assert.equal(h.store.snapshot().activation?.phase, "preparing");
  h.ready();
  await h.store.refresh();
  assert.equal(h.store.snapshot().activation, null);
  assert.equal(h.store.snapshot().notice, "New preset is ready");
});

test("a stale snapshot never completes a pending activation", async () => {
  const h = await setup();
  await h.store.activate(h.target, 1);
  h.ready();
  h.state().stale = true;
  await h.store.refresh();
  assert.equal(h.store.snapshot().activation?.phase, "preparing");
  h.state().stale = false;
  await h.store.refresh();
  assert.equal(h.store.snapshot().activation, null);
});

test("snapshot identity, not a duplicate preset name, confirms the selection", async () => {
  const h = await setup();
  h.state().active!.name = "New preset";
  await h.store.activate(h.target, 1);
  h.state().updated_at++;
  await h.store.refresh();
  assert.ok(h.store.snapshot().activation);
  h.ready();
  await h.store.refresh();
  assert.equal(h.store.snapshot().activation, null);
});

test("command rejection releases controls and keeps the error", async () => {
  const h = await setup();
  h.reply(Promise.resolve({ ok: false, error: "GPU unavailable" }));
  assert.equal(await h.store.activate(h.target, 1), false);
  assert.equal(h.store.snapshot().activation, null);
  assert.equal(h.store.snapshot().error, "GPU unavailable");
});

test("compilation failure ends preparation without announcing readiness", async () => {
  const h = await setup();
  await h.store.activate(h.target, 1);
  h.state().updated_at++;
  h.state().status.state = "error";
  h.state().status.reason = "Pipeline creation failed";
  await h.store.refresh();
  assert.equal(h.store.snapshot().activation, null);
  assert.equal(h.store.snapshot().error, "Pipeline creation failed");
  assert.equal(h.store.snapshot().notice, "");
});

test("a previous error snapshot does not fail a new request", async () => {
  const h = await setup();
  h.state().status.state = "error";
  h.state().status.reason = "Previous failure";
  await h.store.refresh();
  await h.store.activate(h.target, 1);
  assert.ok(h.store.snapshot().activation);
  assert.equal(h.store.snapshot().error, "");
  h.ready();
  await h.store.refresh();
  assert.equal(h.store.snapshot().notice, "New preset is ready");
});

test("renderer replacement releases controls without replaying the command", async () => {
  const h = await setup();
  await h.store.activate(h.target, 1);
  h.setState({ ...snapshot(), session: "replacement" });
  await h.store.refresh();
  assert.equal(h.store.snapshot().activation, null);
  assert.match(h.store.snapshot().error, /changed its renderer/);
  assert.equal(h.calls(), 1);
});

test("repeated selection during preparation does not queue duplicate work", async () => {
  const h = await setup();
  const applying = h.store.activate(h.target, 1);
  assert.equal(await h.store.activate(h.target, 1), false);
  await applying;
  assert.equal(h.calls(), 1);
});

test("polling can continue after the Quick Access component remounts", async () => {
  const h = await setup();
  await h.store.activate(h.target, 1);
  const stop = h.store.watch();
  stop();
  assert.ok(h.store.snapshot().activation);
  h.ready();
  await h.store.refresh();
  assert.equal(h.store.snapshot().activation, null);
  h.store.dispose();
});
