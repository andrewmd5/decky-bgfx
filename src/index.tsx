import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ButtonItem, ConfirmModal, DialogBody, DialogButton, DialogFooter, DialogHeader,
  DropdownItem, Field, ModalRoot, PanelSection, PanelSectionRow, showModal, staticClasses,
} from "@decky/ui";
import { definePlugin, useQuickAccessVisible } from "@decky/api";
import { FaChevronRight, FaMagic } from "react-icons/fa";
import { PreparationStatus } from "./PreparationStatus";
import { EffectSettings, HudControl, effectSummary } from "./EffectControls";
import { isPreparing } from "./SessionStore";
import { Compatibility, State, compatibilityDetail, compatibilityLabel, store, targetOf } from "./ipc";

function PresetNotice({ name, support, closeModal }: {
  name: string; support: Compatibility; closeModal?: () => void;
}) {
  return <ConfirmModal strTitle={name}
    strDescription={`${compatibilityLabel(support)}. ${compatibilityDetail(support)}`}
    strOKButtonText="Done" bAlertDialog onOK={closeModal} onCancel={closeModal} closeModal={closeModal} />;
}

function Diagnostics({ data, error, closeModal }: { data: State; error: string; closeModal?: () => void }) {
  const [copyResult, setCopyResult] = useState("");
  const report = [
    "BGFX Decky status", `App: ${data.app_id || "non-Steam"} · PID: ${data.pid}`,
    `IPC: ${data.protocol} · Preset: ${data.active?.name ?? "None"}`,
    `Renderer: ${data.presentation?.path ?? "Unknown"} · Session: ${data.session}`,
    `GPU checked: ${data.compatibility_adapter || "Pending"}`,
    ...(data.active ? [`Preset support: ${compatibilityLabel(data.active.compatibility)}`,
      data.active.compatibility.diagnostic] : []),
    `State: ${data.status.state}`, data.status.reason ?? "", error,
    `Source: ${data.status.source_fps} FPS · Generated: ${data.status.generated_fps} FPS`,
    `Submitted: ${data.status.submitted_fps} FPS · Failed presents: ${data.status.failed_presents}`,
    `Resolution: ${data.status.width} × ${data.status.height} · Multiplier: ${data.status.multiplier}×`,
    `Snapshot: ${new Date(data.updated_at).toISOString()}`,
  ].filter(Boolean).join("\n");
  return <ModalRoot onCancel={closeModal} closeModal={closeModal}>
    <DialogHeader>Diagnostics</DialogHeader>
    <DialogBody style={{ maxHeight: "55vh", overflowY: "auto", minWidth: 0 }}>
      <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text", lineHeight: 1.5 }}>
        {report}
      </div>
      <Field label="Logs & support report" description="Holo → Start → Diagnostics" />
      {copyResult && <div role="status">{copyResult}</div>}
    </DialogBody>
    <DialogFooter style={{ display: "flex", gap: 12 }}>
      <DialogButton onClick={() => {
        void navigator.clipboard?.writeText(report).then(() => setCopyResult("Copied"))
          .catch(() => setCopyResult("Clipboard unavailable. Use Holo's support report."));
        if (!navigator.clipboard) setCopyResult("Clipboard unavailable. Use Holo's support report.");
      }}>Copy status</DialogButton>
      <DialogButton onClick={closeModal}>Done</DialogButton>
    </DialogFooter>
  </ModalRoot>;
}

function Content() {
  const view = useSyncExternalStore(store.subscribe, store.snapshot);
  const visible = useQuickAccessVisible();
  useEffect(() => visible ? store.watch() : undefined, [visible]);
  const data = view.data;
  const active = data?.active;
  const status = data?.status;
  const selectedPreset = view.activation?.index ?? active?.index;
  const preparing = isPreparing(view);
  const blocked = !view.connected || !!data?.stale || preparing;
  const target = data ? targetOf(data) : null;
  const fps = (value: number) => !view.connected || data?.stale || !Number.isFinite(value)
    ? "—" : Math.max(0, Math.round(value)).toString();

  return <>
    {(!data || view.sessions.length > 1) && <PanelSection title="Game">
      {view.sessions.length > 1 && <PanelSectionRow>
        <DropdownItem label="Game" layout="below" selectedOption={data?.game}
          strDefaultLabel="Select a running game"
          rgOptions={view.sessions.map(session => ({
            data: session.game, label: session.app_id ? `App ${session.app_id}` : `Game · PID ${session.pid}`,
          }))} onChange={option => void store.select(option.data)} />
      </PanelSectionRow>}
      {!data ? <>
        <PanelSectionRow><Field label={view.connecting ? "Connecting…" : "No active connection"}
          description={view.error || "Enable BGFX in Holo, then restart the game."} /></PanelSectionRow>
        <PanelSectionRow><ButtonItem layout="below" onClick={() => void store.select(null)}>Find running game</ButtonItem></PanelSectionRow>
      </> : null}
    </PanelSection>}
    {data && target && <>
      <PanelSection title="Performance">
        <PanelSectionRow><Field label="Game" focusable highlightOnFocus>
          <span style={{ display: "block", minWidth: 80, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {fps(status!.source_fps)} FPS
          </span>
        </Field></PanelSectionRow>
        {status?.frame_generation && <PanelSectionRow>
          <Field label="Generated" focusable highlightOnFocus>
            <span style={{ display: "block", minWidth: 80, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {fps(status.generated_fps)} FPS
            </span>
          </Field>
        </PanelSectionRow>}
      </PanelSection>
      <PanelSection>
        <PanelSectionRow><DropdownItem label="Preset" layout="below"
          disabled={blocked} selectedOption={selectedPreset} strDefaultLabel="Choose a preset"
          rgOptions={data.presets.map(preset => ({
            data: preset.index,
            label: `${preset.is_favorite ? "★ " : ""}${preset.name}${preset.compatibility.status === "Supported"
              ? "" : ` · ${compatibilityLabel(preset.compatibility)}`}`,
          }))}
          onChange={option => {
            const preset = data.presets.find(item => item.index === option.data);
            if (!preset) return;
            if (preset.compatibility.status !== "Supported") {
              showModal(<PresetNotice name={preset.name} support={preset.compatibility} />);
              return;
            }
            void store.activate(target, preset.index);
          }} />
        </PanelSectionRow>
        <PanelSectionRow><PreparationStatus view={view} /></PanelSectionRow>
        {active && active.compatibility.status !== "Supported" && <PanelSectionRow>
          <Field label={compatibilityLabel(active.compatibility)} description={compatibilityDetail(active.compatibility)} />
        </PanelSectionRow>}
      </PanelSection>
      {!!active?.effects.length && <PanelSection title="Effects">
        {active.effects.map((effect, index) => <PanelSectionRow key={`${active.index}:${index}:${effect.name}`}>
          <Field label={effect.name} description={effectSummary(effect)}
            focusable highlightOnFocus disabled={blocked}
            onActivate={() => {
              if (!blocked) {
                showModal(<EffectSettings session={data.session} preset={active.index}
                  index={index} name={effect.name} />);
              }
            }}>
            <FaChevronRight aria-hidden />
          </Field>
        </PanelSectionRow>)}
        {data.dirty && <PanelSectionRow>
          <ButtonItem layout="below" disabled={blocked}
            description="Changes apply immediately. Save to keep them."
            onClick={() => void store.edit(target, [{ cmd: "save" }], "Preset saved")}>
            Save preset
          </ButtonItem>
        </PanelSectionRow>}
      </PanelSection>}
      <PanelSection>
        {active && <PanelSectionRow>
          <HudControl key={`${data.session}:${active.token}`} value={active.show_hud} target={target} disabled={blocked} />
        </PanelSectionRow>}
      </PanelSection>
      <PanelSection>
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
