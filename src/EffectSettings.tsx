import { FC, useEffect, useState, useSyncExternalStore } from "react";
import { ButtonItem, DropdownItem, Field, ModalRoot, PanelSection, PanelSectionRow, SliderField, ToggleField } from "@decky/ui";
import { EffectEntry, Parameter, State, store, targetOf } from "./ipc";

const scalingOptions = [
  { data: "auto", label: "Automatic" }, { data: "integer", label: "Integer" },
  { data: "fit", label: "Fit" }, { data: "stretch", label: "Stretch" }, { data: "fill", label: "Fill" },
];
export const labeledOptions = (param: Parameter) => (param.labels ?? []).map((label, i) => ({
  label, data: param.min + i * param.step,
}));

export const EffectSettings: FC<{ initial: State; index: number; closeModal?: () => void }> =
  ({ initial, index, closeModal }) => {
    const view = useSyncExternalStore(store.subscribe, store.snapshot);
    useEffect(() => store.watch(), []);
    const original = initial.active!.effects[index];
    const [baseline, setBaseline] = useState<EffectEntry>(original);
    const [values, setValues] = useState<Record<string, number>>({});
    const [scaling, setScaling] = useState(original.scaling);
    const [applying, setApplying] = useState(false);
    const target = targetOf(initial);
    const current = view.data;
    const changedSession = !current || current.session !== target.session || current.active?.token !== target.preset;
    const changed = Object.keys(values).length > 0 || scaling !== baseline.scaling;
    const blocked = changedSession || view.busy || applying || current?.status.state === "compiling";
    const valueOf = (p: Parameter) => values[p.name] ?? Number(p.value);
    const update = (param: Parameter, value: number) => setValues(previous => {
      const next = { ...previous };
      if (value === Number(param.value)) delete next[param.name];
      else next[param.name] = value;
      return next;
    });
    const close = () => { if (!applying) closeModal?.(); };
    const apply = async () => {
      setApplying(true);
      const edits = Object.entries(values).map(([name, value]) => ({
        cmd: "set_param", args: { effect: index, name, value },
      }));
      const changes = scaling === baseline.scaling ? edits
        : [...edits, { cmd: "set_scaling", args: { effect: index, value: scaling } }];
      try {
        if (await store.edit(target, changes)) {
          const updated = store.snapshot().data?.active?.effects[index];
          if (updated) { setBaseline(updated); setScaling(updated.scaling); setValues({}); }
        }
      } finally { setApplying(false); }
    };
    return (
      <ModalRoot onCancel={close} closeModal={close} bCancelDisabled={applying}>
        <PanelSection title={original.name}>
          {changedSession && <PanelSectionRow>
            <Field label="Game or preset changed" description="Reopen settings." />
          </PanelSectionRow>}
          {view.error && <PanelSectionRow><Field label="Could not apply changes" description={view.error} /></PanelSectionRow>}
          {baseline.can_scale && <PanelSectionRow>
            <DropdownItem label="Scaling" rgOptions={scalingOptions} selectedOption={scaling}
              disabled={blocked} onChange={option => setScaling(option.data)} />
          </PanelSectionRow>}
          {baseline.params.map(param => <PanelSectionRow key={param.name}>
            {param.type === "texture" ? <Field label={param.label}
              description="Edit in Holo">
              {String(param.value).split(/[\\/]/).pop() || "Default"}
            </Field> : param.type === "bool" ?
              <ToggleField label={param.label}
                checked={valueOf(param) > 0.5} disabled={blocked}
                onChange={checked => update(param, checked ? 1 : 0)} />
              : param.labels?.length ?
                <DropdownItem label={param.label}
                  rgOptions={labeledOptions(param)} selectedOption={valueOf(param)} disabled={blocked}
                  onChange={option => update(param, option.data)} />
                : <SliderField label={param.label}
                    value={valueOf(param)} min={param.min} max={param.max} step={param.step}
                    resetValue={Number(param.default)} validValues="steps" showValue disabled={blocked}
                    onChange={value => update(param, value)} />}
          </PanelSectionRow>)}
          <PanelSectionRow><ButtonItem disabled={blocked} layout="below" onClick={() => {
            const defaults: Record<string, number> = {};
            for (const param of baseline.params)
              if (param.type !== "texture" && param.value !== param.default) defaults[param.name] = Number(param.default);
            setValues(defaults); setScaling("auto");
          }}>Reset to defaults</ButtonItem></PanelSectionRow>
          <PanelSectionRow><ButtonItem disabled={blocked || !changed} layout="below" onClick={() => void apply()}>
            {applying ? "Applying…" : "Apply changes"}
          </ButtonItem></PanelSectionRow>
          <PanelSectionRow><ButtonItem disabled={applying} layout="below" onClick={close}>
            {changed ? "Discard and close" : "Done"}
          </ButtonItem></PanelSectionRow>
        </PanelSection>
      </ModalRoot>
    );
  };
