export const compatibilityMessages = {
  Checking: { label: "Checking GPU support…", description: "" },
  Supported: { label: "Supported", description: "" },
  PreparationRequired: {
    label: "Preparation required",
    description: "Install this effect again to prepare it for your current GPU and driver.",
  },
  UnsupportedHardware: {
    label: "Unsupported on this GPU",
    description: "This effect needs GPU features that are not available on the selected renderer and device.",
  },
  ProviderNotInstalled: {
    label: "GPU software unavailable",
    description: "The GPU software needed by this effect is not installed or is not available for this system.",
  },
  ProviderUnavailable: {
    label: "GPU software unavailable",
    description: "The GPU software needed by this effect could not be loaded. The diagnostic report has the details.",
  },
  EffectNotInstalled: {
    label: "Effect not installed",
    description: "Install the missing effect to use this preset.",
  },
  CheckFailed: {
    label: "GPU check failed",
    description: "Couldn’t check this effect on the selected GPU. The diagnostic report has the details.",
  },
} as const;
