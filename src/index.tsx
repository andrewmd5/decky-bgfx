import { useEffect, useState, useSyncExternalStore } from "react";
import { ButtonItem, DropdownItem, Field, ModalRoot, PanelSection, PanelSectionRow, ToggleField, showModal, staticClasses } from "@decky/ui";
import { definePlugin, useQuickAccessVisible } from "@decky/api";
import { FaMagic } from "react-icons/fa";
import { EffectSettings, labeledOptions } from "./EffectSettings";
import { State, store, targetOf } from "./ipc";

const stateLabels: Record<string, string> = {
  generating: "Generating frames", waiting: "Waiting for frame generation",
  compiling: "Preparing effects", active: "Effects active", passthrough: "Frame generation off", error: "Effect error",
};

function Diagnostics({ data, closeModal }: { data: State; closeModal?: () => void }) {
  const [copyResult, setCopyResult] = useState("");
  const report = [
    "BGFX Decky status", `App: ${data.app_id || "non-Steam"} · PID: ${data.pid}`,
    `IPC: ${data.protocol} · Preset: ${data.active?.name ?? "None"}`,
    `State: ${data.status.state}`, data.status.reason ?? "",
    `Source: ${data.status.source_fps} FPS · Generated: ${data.status.generated_fps} FPS`,
    `Submitted: ${data.status.submitted_fps} FPS · Failed presents: ${data.status.failed_presents}`,
    `Resolution: ${data.status.width} × ${data.status.height} · Multiplier: ${data.status.multiplier}×`,
    `Snapshot: ${new Date(data.updated_at).toISOString()}`,
  ].filter(Boolean).join("\n");
  return <ModalRoot onCancel={closeModal} closeModal={closeModal}>
    <PanelSection title="Diagnostics">
      <PanelSectionRow><Field label="BGFX layer" description={
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text" }}>{report}</div>
      } /></PanelSectionRow>
      <PanelSectionRow><Field label="Logs & support report"
        description="Holo → Start → Diagnostics" /></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={() => {
        void navigator.clipboard?.writeText(report).then(() => setCopyResult("Copied"))
          .catch(() => setCopyResult("Clipboard unavailable. Use Holo's support report."));
        if (!navigator.clipboard) setCopyResult("Clipboard unavailable. Use Holo's support report.");
      }}>{copyResult || "Copy status"}</ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={closeModal}>Done</ButtonItem></PanelSectionRow>
    </PanelSection>
  </ModalRoot>;
}

function Content() {
  const view = useSyncExternalStore(store.subscribe, store.snapshot);
  const visible = useQuickAccessVisible();
  useEffect(() => visible ? store.watch() : undefined, [visible]);
  const data = view.data;
  const active = data?.active;
  const busy = view.busy || data?.status.state === "compiling";
  const target = data ? targetOf(data) : null;
  const change = (cmd: string, args: Record<string, unknown>, notice?: string) => {
    if (target) void store.edit(target, [{ cmd, args }], notice);
  };
  const generatorIndex = active?.effects.findIndex(effect => !!effect.multiplier_parameter) ?? -1;
  const generator = generatorIndex >= 0 ? active?.effects[generatorIndex] : null;
  const settings = active?.effects.map((effect, index) => ({ effect, index }))
    .filter(({ effect, index }) => index !== generatorIndex || effect.can_scale ||
      effect.params.some(param => param.type !== "bool" && !param.labels?.length)) ?? [];
  const status = data?.status;
  return <>
    <PanelSection title="Borderless Gaming">
      {view.sessions.length > 1 && <PanelSectionRow>
        <DropdownItem label="Game session" selectedOption={data?.session}
          disabled={view.busy} strDefaultLabel="Select a running game"
          rgOptions={view.sessions.map(session => ({
            data: session.session, label: `${session.app_id ? `App ${session.app_id}` : "Game"} · PID ${session.pid}`,
          }))} onChange={option => void store.select(option.data)} />
      </PanelSectionRow>}
      {!data ? <>
        <PanelSectionRow><Field label={view.connecting ? "Connecting…" : "No active connection"}
          description={view.error || "Looking for a running game with the BGFX layer."} /></PanelSectionRow>
        <PanelSectionRow><Field description="Enable BGFX in Holo, then restart the game." /></PanelSectionRow>
        <PanelSectionRow><ButtonItem layout="below" onClick={() => void store.select(null)}>Find running game</ButtonItem></PanelSectionRow>
      </> : <>
        <PanelSectionRow><Field
          label={data.stale ? "Game paused or not presenting" : status!.state === "passthrough" && !status!.frame_generation
            ? "Pass-through" : stateLabels[status!.state] ?? status!.state}
          description={data.stale ? "Resume the game to update."
            : data.requested_preset ? `Loading ${data.requested_preset}…`
            : status!.reason || (status!.state === "waiting"
              ? "No generated frames yet."
              : status!.state === "compiling" ? `${status!.effect || "GPU pipelines"}${status!.pass_count ? ` · ${status!.pass}/${status!.pass_count}` : ""}`
              : undefined)} />
        </PanelSectionRow>
        {status!.frame_generation && <PanelSectionRow>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", fontVariantNumeric: "tabular-nums" }}>
            {[["Source", status!.source_fps], ["Generated", status!.generated_fps], ["Submitted", status!.submitted_fps]].map(([label, fps]) =>
              <div key={label} style={{ flex: 1 }}>
                <div style={{ fontSize: 11, opacity: 0.65 }}>{label}</div>
                <div style={{ fontSize: 23, fontWeight: 600 }}>{data.stale ? "—" : fps}<span style={{ fontSize: 10, marginLeft: 4 }}>FPS</span></div>
              </div>)}
          </div>
        </PanelSectionRow>}
        {view.error && <PanelSectionRow><Field label="Change not confirmed" description={view.error} /></PanelSectionRow>}
      </>}
    </PanelSection>
    {data && <>
      <PanelSection title="Preset">
        <PanelSectionRow><DropdownItem label="Active preset"
          disabled={busy} selectedOption={active?.index} strDefaultLabel="Choose a preset"
          rgOptions={data.presets.map(preset => ({
            data: preset.index, label: `${preset.is_favorite ? "★ " : ""}${preset.name}`,
          }))}
          onChange={option => change("activate", { index: option.data })} />
        </PanelSectionRow>
      </PanelSection>
      {generator && <PanelSection title="Frame generation">
        {generator.params.filter(param => param.type === "bool" || param.labels?.length).map(param =>
          <PanelSectionRow key={param.name}>
            {param.type === "bool" ? <ToggleField label={param.label}
              checked={Number(param.value) > 0.5} disabled={busy}
              onChange={checked => change("set_param", { effect: generatorIndex, name: param.name, value: checked ? 1 : 0 })} />
              : <DropdownItem label={param.label}
                  rgOptions={labeledOptions(param)} selectedOption={param.value} disabled={busy}
                  onChange={option => change("set_param", { effect: generatorIndex, name: param.name, value: option.data })} />}
          </PanelSectionRow>)}
        <PanelSectionRow><ToggleField label="Keep FPS visible" checked={active!.show_hud} disabled={busy}
          onChange={value => change("set_hud", { value })} /></PanelSectionRow>
      </PanelSection>}
      {settings.length > 0 && <PanelSection title="Effects">
        {settings.map(({ effect, index }) => <PanelSectionRow key={`${active!.token}:${index}`}>
          <ButtonItem layout="below" disabled={busy}
            description={effect.can_scale ? `Scaling: ${effect.scaling}` : undefined}
            onClick={() => showModal(<EffectSettings initial={data} index={index} />)}>
            {effect.name}
          </ButtonItem>
        </PanelSectionRow>)}
      </PanelSection>}
      <PanelSection>
        <PanelSectionRow><ButtonItem layout="below" disabled={busy || !active}
          onClick={() => change("save", {}, "Preset saved")}>{view.busy ? "Working…" : view.notice || "Save preset"}</ButtonItem></PanelSectionRow>
        <PanelSectionRow><ButtonItem layout="below" onClick={() => showModal(<Diagnostics data={data} />)}>Diagnostics</ButtonItem></PanelSectionRow>
      </PanelSection>
    </>}
  </>;
}

export default definePlugin(() => ({
  name: "BGFX",
  titleView: <div className={staticClasses.Title}>BGFX</div>,
  content: <Content />,
  icon: <FaMagic />,
  onDismount: () => store.dispose(),
}));
