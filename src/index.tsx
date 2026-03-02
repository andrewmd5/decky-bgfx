import {
  ButtonItem,
  DropdownItem,
  Field,
  ModalRoot,
  PanelSection,
  PanelSectionRow,
  showModal,
  SliderField,
  ToggleField,
  staticClasses,
} from "@decky/ui";
import { callable, definePlugin } from "@decky/api";
import { useState, useEffect, useRef, useCallback, FC } from "react";
import { FaMagic } from "react-icons/fa";

interface Param {
  name: string;
  label: string;
  type: "float" | "int" | "bool" | "texture";
  value: number | string;
  min?: number;
  max?: number;
  step?: number;
  default?: number | string;
}

interface EffectEntry {
  name: string;
  scaling: string;
  params: Param[];
}

interface Preset {
  name: string;
  index: number;
  chain_count: number;
  is_favorite: boolean;
}

interface IpcResult {
  ok: boolean;
  error?: string;
}

interface PresetListResult extends IpcResult {
  presets: Preset[];
}

interface ActivePresetResult extends IpcResult {
  index: number;
  name: string;
  effects: EffectEntry[];
}

const isConnected = callable<[], boolean>("is_connected");
const getPresets = callable<[], PresetListResult>("get_presets");
const getActive = callable<[], ActivePresetResult>("get_active");
const activatePreset = callable<[index: number], IpcResult>("activate_preset");
const setParamCall = callable<[effect: number, name: string, value: number], IpcResult>("set_param");
const _setTexture = callable<[effect: number, name: string, value: string], IpcResult>("set_texture");
void _setTexture;
const setScalingCall = callable<[effect: number, value: string], IpcResult>("set_scaling");
const savePreset = callable<[], IpcResult>("save_preset");

const SCALING_OPTIONS = [
  { data: "auto", label: "Auto" },
  { data: "integer", label: "Integer" },
  { data: "fit", label: "Fit" },
  { data: "stretch", label: "Stretch" },
  { data: "fill", label: "Fill" },
];

function shortName(name: string): string {
  const slash = name.lastIndexOf("/");
  const backslash = name.lastIndexOf("\\");
  const sep = Math.max(slash, backslash);
  const base = sep >= 0 ? name.substring(sep + 1) : name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.substring(0, dot) : base;
}

interface EffectModalProps {
  closeModal?: () => void;
  effect: EffectEntry;
  effectIdx: number;
  onScalingChange: (value: string) => void;
  onParamChange: (param: Param, value: number) => void;
  onBoolChange: (param: Param, checked: boolean) => void;
}

const EffectModal: FC<EffectModalProps> = ({ closeModal, effect, effectIdx, onScalingChange, onParamChange, onBoolChange }) => {
  const [scaling, setScaling] = useState(effect.scaling);
  const [params, setParams] = useState(effect.params);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleScaling = (value: string) => {
    setScaling(value);
    onScalingChange(value);
  };

  const handleParam = (param: Param, value: number) => {
    const key = `${effectIdx}:${param.name}`;
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(() => {
      onParamChange(param, value);
      delete debounceTimers.current[key];
    }, 50);
    setParams((prev) => prev.map((p) => p.name === param.name ? { ...p, value } : p));
  };

  const handleBool = (param: Param, checked: boolean) => {
    onBoolChange(param, checked);
    setParams((prev) => prev.map((p) => p.name === param.name ? { ...p, value: checked ? 1.0 : 0.0 } : p));
  };

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <PanelSection title={shortName(effect.name)}>
        <PanelSectionRow>
          <DropdownItem
            label="Scaling"
            rgOptions={SCALING_OPTIONS}
            selectedOption={scaling}
            onChange={(opt) => handleScaling(opt.data)}
          />
        </PanelSectionRow>

        {params.map((param) => {
          if (param.type === "bool") {
            return (
              <PanelSectionRow key={param.name}>
                <ToggleField
                  label={param.label}
                  checked={(param.value as number) > 0.5}
                  onChange={(checked: boolean) => handleBool(param, checked)}
                />
              </PanelSectionRow>
            );
          }
          if (param.type === "texture") {
            return (
              <PanelSectionRow key={param.name}>
                <Field label={param.label}>
                  {shortName((param.value as string) || "") || "(default)"}
                </Field>
              </PanelSectionRow>
            );
          }
          return (
            <PanelSectionRow key={param.name}>
              <SliderField
                label={param.label}
                value={param.value as number}
                min={param.min ?? 0}
                max={param.max ?? 1}
                step={param.step ?? 0.01}
                onChange={(value: number) => handleParam(param, value)}
                showValue
              />
            </PanelSectionRow>
          );
        })}
      </PanelSection>
    </ModalRoot>
  );
};

const Content: FC = () => {
  const [connected, setConnected] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [effects, setEffects] = useState<EffectEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const conn = await isConnected();
    setConnected(conn);
    if (!conn) {
      setLoading(false);
      return;
    }
    const [pRes, aRes] = await Promise.all([getPresets(), getActive()]);
    if (pRes.ok) setPresets(pRes.presets);
    if (aRes.ok) {
      setActiveIndex(aRes.index);
      setEffects(aRes.effects);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(async () => {
      const conn = await isConnected();
      setConnected(conn);
      if (conn && presets.length === 0) refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const onPresetChange = useCallback(async (index: number) => {
    await activatePreset(index);
    setActiveIndex(index);
    setTimeout(async () => {
      const aRes = await getActive();
      if (aRes.ok) {
        setActiveIndex(aRes.index);
        setEffects(aRes.effects);
      }
    }, 500);
  }, []);

  const openEffect = (effectIdx: number) => {
    const effect = effects[effectIdx];
    showModal(
      <EffectModal
        effect={effect}
        effectIdx={effectIdx}
        onScalingChange={(value) => {
          setScalingCall(effectIdx, value);
          setEffects((prev) => prev.map((e, i) => i === effectIdx ? { ...e, scaling: value } : e));
        }}
        onParamChange={(param, value) => {
          setParamCall(effectIdx, param.name, value);
          setEffects((prev) =>
            prev.map((e, i) =>
              i === effectIdx
                ? { ...e, params: e.params.map((p) => p.name === param.name ? { ...p, value } : p) }
                : e
            )
          );
        }}
        onBoolChange={(param, checked) => {
          const value = checked ? 1.0 : 0.0;
          setParamCall(effectIdx, param.name, value);
          setEffects((prev) =>
            prev.map((e, i) =>
              i === effectIdx
                ? { ...e, params: e.params.map((p) => p.name === param.name ? { ...p, value } : p) }
                : e
            )
          );
        }}
      />
    );
  };

  if (!connected) {
    return (
      <PanelSection title="BGFX">
        <PanelSectionRow>
          <Field label={loading ? "Connecting..." : "No game running with BGFX layer."} />
        </PanelSectionRow>
      </PanelSection>
    );
  }

  const presetOptions = presets.map((p) => ({
    data: p.index,
    label: p.is_favorite ? `\u2605 ${shortName(p.name)}` : shortName(p.name),
  }));

  const scalingLabel = (s: string) => SCALING_OPTIONS.find((o) => o.data === s)?.label ?? s;

  return (
    <>
      {presetOptions.length > 0 && activeIndex !== null && (
        <PanelSection title="Preset">
          <PanelSectionRow>
            <DropdownItem
              rgOptions={presetOptions}
              selectedOption={activeIndex}
              onChange={(opt) => onPresetChange(opt.data)}
            />
          </PanelSectionRow>
        </PanelSection>
      )}

      <PanelSection title="Effects">
        {effects.map((effect, effectIdx) => (
          <PanelSectionRow key={effectIdx}>
            <ButtonItem
              description={`${scalingLabel(effect.scaling)} \u00B7 ${effect.params.length} params`}
              layout="below"
              onClick={() => openEffect(effectIdx)}
            >
              {shortName(effect.name)}
            </ButtonItem>
          </PanelSectionRow>
        ))}
      </PanelSection>

      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => savePreset()}>
            Save Preset
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};

export default definePlugin(() => {
  return {
    name: "BGFX",
    titleView: <div className={staticClasses.Title}>BGFX</div>,
    content: <Content />,
    icon: <FaMagic />,
    onDismount() {},
  };
});
