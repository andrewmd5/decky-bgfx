import { useEffect, useRef, useState } from "react";
import { ButtonItem, DropdownItem, Field, PanelSection, PanelSectionRow, SliderField, ToggleField } from "@decky/ui";
import { EffectEntry, Parameter, Target, store } from "./ipc";

const scalingOptions = [
  { data: "auto", label: "Automatic" }, { data: "integer", label: "Integer" },
  { data: "fit", label: "Fit" }, { data: "stretch", label: "Stretch" }, { data: "fill", label: "Fill" },
];
const labeledOptions = (param: Parameter) => (param.labels ?? []).map((label, i) => ({
  label, data: param.min + i * param.step,
}));

function useLiveValue<T>(value: T, submit: (value: T) => Promise<boolean>, disabled: boolean) {
  const [draft, setDraft] = useState<{ value: T }>();
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);

  const change = (next: T) => {
    if (disabled) return;
    const request = ++revision.current;
    setDraft({ value: next });
    void submit(next).then(() => {
      if (revision.current === request) setDraft(undefined);
    });
  };
  return [draft ? draft.value : value, change] as const;
}

function ParameterControl({ param, index, target, disabled }: {
  param: Parameter; index: number; target: Target; disabled: boolean;
}) {
  const [value, change] = useLiveValue(Number(param.value), value =>
    store.setValue(target, { cmd: "set_param", args: { effect: index, name: param.name, value } }), disabled);
  if (param.type === "bool")
    return <ToggleField label={param.label} checked={value > 0.5} disabled={disabled}
      onChange={checked => change(checked ? 1 : 0)} />;
  if (param.labels?.length)
    return <DropdownItem label={param.label} rgOptions={labeledOptions(param)}
      selectedOption={value} disabled={disabled} onChange={option => change(option.data)} />;
  return <SliderField label={param.label} value={value} min={param.min} max={param.max}
    step={param.step} resetValue={Number(param.default)} validValues="steps" showValue
    disabled={disabled} onChange={change} />;
}

export function EffectControls({ effect, index, target, disabled }: {
  effect: EffectEntry; index: number; target: Target; disabled: boolean;
}) {
  const [scaling, changeScaling] = useLiveValue(effect.scaling, value =>
    store.setValue(target, { cmd: "set_scaling", args: { effect: index, value } }), disabled);
  const reset = () => {
    if (disabled) return;
    const edits = effect.params.filter(param => param.type !== "texture")
      .map(param => ({ cmd: "set_param", args: { effect: index, name: param.name, value: Number(param.default) } }));
    void store.edit(target, effect.can_scale
      ? [...edits, { cmd: "set_scaling", args: { effect: index, value: "auto" } }] : edits);
  };
  return <PanelSection title={effect.name}>
    {effect.can_scale && <PanelSectionRow>
      <DropdownItem label="Scaling" rgOptions={scalingOptions} selectedOption={scaling}
        disabled={disabled} onChange={option => changeScaling(option.data)} />
    </PanelSectionRow>}
    {effect.params.map(param => <PanelSectionRow key={param.name}>
      {param.type === "texture" ? <Field label={param.label} description="Edit in Holo">
        <span style={{ display: "block", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {String(param.value).split(/[\\/]/).pop() || "Default"}
        </span>
      </Field> : <ParameterControl param={param} index={index} target={target} disabled={disabled} />}
    </PanelSectionRow>)}
    {(effect.can_scale || effect.params.some(param => param.type !== "texture")) && <PanelSectionRow>
      <ButtonItem layout="below" disabled={disabled} onClick={reset}>Reset to defaults</ButtonItem>
    </PanelSectionRow>}
  </PanelSection>;
}

export function HudControl({ value, target, disabled }: { value: boolean; target: Target; disabled: boolean }) {
  const [checked, change] = useLiveValue(value, value =>
    store.setValue(target, { cmd: "set_hud", args: { value } }), disabled);
  return <ToggleField label="Keep FPS visible" checked={checked} disabled={disabled} onChange={change} />;
}
