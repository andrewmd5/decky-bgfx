import { useEffect, useState, useSyncExternalStore } from "react";
import { ButtonItem, DropdownItem, Field, ModalRoot, PanelSection, PanelSectionRow, showModal, staticClasses } from "@decky/ui";
import { definePlugin, useQuickAccessVisible } from "@decky/api";
import { FaMagic } from "react-icons/fa";
import { EffectControls, HudControl } from "./EffectControls";
import { State, store, targetOf } from "./ipc";

function Diagnostics({ data, error, closeModal }: { data: State; error: string; closeModal?: () => void }) {
  const [copyResult, setCopyResult] = useState("");
  const report = [
    "BGFX Decky status", `App: ${data.app_id || "non-Steam"} · PID: ${data.pid}`,
    `IPC: ${data.protocol} · Preset: ${data.active?.name ?? "None"}`,
    `State: ${data.status.state}`, data.status.reason ?? "", error,
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
  const status = data?.status;
  const blocked = !view.connected || status?.state === "compiling" || !!data?.requested_preset;
  const target = data ? targetOf(data) : null;
  const message = view.error || (data?.requested_preset ? `Loading ${data.requested_preset}…`
    : status?.state === "error" ? status.reason || "Effect error. Open Diagnostics."
    : status?.state === "compiling"
      ? `Preparing ${status.effect || "effects"}${status.pass_count ? ` · ${status.pass}/${status.pass_count}` : ""}`
    : view.notice);
  const fps = (value: number) => !view.connected || data?.stale || !Number.isFinite(value)
    ? "—" : Math.max(0, Math.round(value)).toString();

  return <>
    <PanelSection title="Borderless Gaming">
      {view.sessions.length > 1 && <PanelSectionRow>
        <DropdownItem label="Game session" selectedOption={data?.session}
          strDefaultLabel="Select a running game"
          rgOptions={view.sessions.map(session => ({
            data: session.session, label: `${session.app_id ? `App ${session.app_id}` : "Game"} · PID ${session.pid}`,
          }))} onChange={option => void store.select(option.data)} />
      </PanelSectionRow>}
      {!data ? <>
        <PanelSectionRow><Field label={view.connecting ? "Connecting…" : "No active connection"}
          description={view.error || "Enable BGFX in Holo, then restart the game."} /></PanelSectionRow>
        <PanelSectionRow><ButtonItem layout="below" onClick={() => void store.select(null)}>Find running game</ButtonItem></PanelSectionRow>
      </> : <PanelSectionRow>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, padding: "10px 0" }}>
          {([["Source", status!.source_fps], ["Generated", status!.generated_fps], ["Submitted", status!.submitted_fps]] as const)
            .map(([label, value]) => <div key={label} style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, lineHeight: "16px", opacity: 0.65, whiteSpace: "nowrap" }}>{label} FPS</div>
              <div style={{ fontSize: 23, lineHeight: "28px", fontWeight: 600, fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fps(value)}</div>
            </div>)}
        </div>
        <div role="status" title={message} style={{ height: 36, fontSize: 12, lineHeight: "18px", opacity: 0.8,
          display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", overflowWrap: "anywhere" }}>
          {message}
        </div>
      </PanelSectionRow>}
    </PanelSection>
    {data && target && <>
      <PanelSection title="Preset">
        <PanelSectionRow><DropdownItem label="Active preset"
          disabled={blocked} selectedOption={active?.index} strDefaultLabel="Choose a preset"
          rgOptions={data.presets.map(preset => ({
            data: preset.index, label: `${preset.is_favorite ? "★ " : ""}${preset.name}`,
          }))}
          onChange={option => void store.edit(target, [{ cmd: "activate", args: { index: option.data } }])} />
        </PanelSectionRow>
        {active && <PanelSectionRow>
          <HudControl key={`${data.session}:${active.token}`} value={active.show_hud} target={target} disabled={blocked} />
        </PanelSectionRow>}
      </PanelSection>
      {active?.effects.map((effect, index) => <EffectControls
        key={`${data.session}:${active.token}:${index}:${effect.name}`}
        effect={effect} index={index} target={target} disabled={blocked} />)}
      <PanelSection>
        <PanelSectionRow><ButtonItem layout="below" disabled={blocked || !active}
          onClick={() => void store.edit(target, [{ cmd: "save" }], "Preset saved")}>Save preset</ButtonItem></PanelSectionRow>
        <PanelSectionRow><ButtonItem layout="below"
          onClick={() => showModal(<Diagnostics data={data} error={view.error} />)}>Diagnostics</ButtonItem></PanelSectionRow>
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
