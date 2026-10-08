import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DialogBody, DialogButton, DialogControlsSection, DialogFooter, DialogHeader,
  DropdownItem, Field, ModalRoot, SliderField, ToggleField,
} from "@decky/ui";
import { Edit, EffectEntry, NumericParameter, Target, store, targetOf } from "./ipc";
import { isPreparing } from "./SessionStore";
import { PreparationStatus } from "./PreparationStatus";

const scalingOptions = [
  { data: "auto", label: "Automatic" },
  { data: "integer", label: "Integer" },
  { data: "fit", label: "Fit" },
  { data: "stretch", label: "Stretch" },
  { data: "fill", label: "Fill" },
];

export function effectSummary(effect: EffectEntry): string {
  const details: string[] = [];
  for (const param of effect.params) {
    if (param.type === "texture") {
      continue;
    }
    if (param.name === effect.multiplier_parameter) {
      details.push(`${param.value}× frame generation`);
    } else if (param.labels?.length) {
      const label = param.labels[Math.round((param.value - param.min) / param.step)];
      if (label) {
        details.push(label === param.label ? label : `${param.label}: ${label}`);
      }
    }
  }
  if (effect.can_scale) {
    const scaling = scalingOptions.find(option => option.data === effect.scaling);
    details.push(`${scaling?.label ?? effect.scaling} scaling`);
  }
  if (details.length === 0) {
    const count = effect.params.length;
    if (count === 0) {
      return "No adjustable settings";
    }
    return `${count} adjustable settings`;
  }
  return details.join(" · ");
}

function useLiveValue<T>(value: T, submit: (value: T) => Promise<boolean>, disabled: boolean) {
  const [draft, setDraft] = useState<{ value: T }>();
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);

  const change = (next: T) => {
    if (disabled) {
      return;
    }
    const request = ++revision.current;
    setDraft({ value: next });
    void submit(next).then(() => {
      if (revision.current === request) {
        setDraft(undefined);
      }
    });
  };
  return [draft ? draft.value : value, change] as const;
}

function ParameterControl({ param, index, target, disabled }: {
  param: NumericParameter; index: number; target: Target; disabled: boolean;
}) {
  const [value, change] = useLiveValue(Number(param.value), value =>
    store.setValue(target, { cmd: "set_param", args: { effect: index, name: param.name, value } }), disabled);
  if (param.type === "bool") {
    return <ToggleField label={param.label} description={param.description} checked={value > 0.5}
      disabled={disabled} onChange={checked => change(checked ? 1 : 0)} />;
  }
  if (param.labels?.length) {
    const options = param.labels.map((label, i) => ({ label, data: param.min + i * param.step }));
    return <DropdownItem layout="below" label={param.label} description={param.description}
      rgOptions={options} selectedOption={value} disabled={disabled}
      onChange={option => change(option.data)} />;
  }
  return <SliderField label={param.label} description={param.description} value={value}
    min={param.min} max={param.max} step={param.step} resetValue={Number(param.default)}
    validValues="steps" showValue editableValue disabled={disabled} onChange={change} />;
}

function EffectControls({ effect, index, target, disabled }: {
  effect: EffectEntry; index: number; target: Target; disabled: boolean;
}) {
  const [scaling, changeScaling] = useLiveValue(effect.scaling, value =>
    store.setValue(target, { cmd: "set_scaling", args: { effect: index, value } }), disabled);
  return <DialogControlsSection>
    {effect.can_scale && <DropdownItem layout="below" label="Scaling" rgOptions={scalingOptions}
      selectedOption={scaling} disabled={disabled} onChange={option => changeScaling(option.data)} />}
    {effect.params.map(param => param.type === "texture"
      ? <Field key={param.name} label={param.label} description={param.description || "Choose this texture in Holo."}
          childrenLayout="below" childrenContainerWidth="max">
          <span style={{ overflowWrap: "anywhere" }}>
            {String(param.value).split(/[\\/]/).pop() || "Default"}
          </span>
        </Field>
      : <ParameterControl key={param.name} param={param} index={index} target={target} disabled={disabled} />)}
  </DialogControlsSection>;
}

export function EffectSettings({ session, preset, index, name, closeModal }: {
  session: string; preset: number; index: number; name: string; closeModal?: () => void;
}) {
  const view = useSyncExternalStore(store.subscribe, store.snapshot);
  useEffect(() => store.watch(), []);
  const data = view.data;
  const active = data?.active;
  const matches = data?.session === session && active?.index === preset;
  const effect = matches ? active.effects[index] : undefined;
  const disabled = !view.connected || !!data?.stale || isPreparing(view);
  const target = data ? targetOf(data) : null;

  const reset = () => {
    if (!effect || !target || disabled) {
      return;
    }
    const edits: Edit[] = effect.params.filter(param => param.type !== "texture")
      .map(param => ({ cmd: "set_param", args: { effect: index, name: param.name, value: Number(param.default) } }));
    if (effect.can_scale) {
      edits.push({ cmd: "set_scaling", args: { effect: index, value: "auto" } });
    }
    void store.edit(target, edits);
  };

  return <ModalRoot onCancel={closeModal} closeModal={closeModal}>
    <DialogHeader>{name}</DialogHeader>
    <DialogBody style={{ maxHeight: "55vh", overflowY: "auto", minWidth: 0 }}>
      {(isPreparing(view) || view.error || !view.connected || data?.stale) && <PreparationStatus view={view} />}
      {effect && target
        ? <EffectControls key={`${session}:${active!.token}:${index}`}
            effect={effect} index={index} target={target} disabled={disabled} />
        : <Field label="Preset changed" description="Close this window to see the current effects." />}
    </DialogBody>
    <DialogFooter style={{ display: "flex", gap: 12 }}>
      <DialogButton disabled={disabled || !effect} onClick={reset}>Reset defaults</DialogButton>
      <DialogButton onClick={closeModal}>Done</DialogButton>
    </DialogFooter>
  </ModalRoot>;
}

export function HudControl({ value, target, disabled }: { value: boolean; target: Target; disabled: boolean }) {
  const [checked, change] = useLiveValue(value, value =>
    store.setValue(target, { cmd: "set_hud", args: { value } }), disabled);
  return <ToggleField label="Show FPS in game" checked={checked} disabled={disabled} onChange={change} />;
}
