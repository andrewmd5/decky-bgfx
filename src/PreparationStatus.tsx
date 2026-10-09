import { Field, ProgressBar, Spinner } from "@decky/ui";
import { isPreparing, type ViewState } from "./SessionStore";

export function PreparationStatus({ view }: { view: ViewState }) {
  const data = view.data;
  const activation = view.activation;
  const compiling = data?.status.state === "compiling" || !!data?.requested_preset;
  const busy = isPreparing(view);
  let title = view.notice || "Effects active";
  let description = "";
  let error = view.error;
  let progress: number | undefined;

  if (busy) {
    const name = activation?.name || data?.requested_preset || data?.active?.name || "effects";
    title = "Preparing effects…";
    description = name;
    if (activation?.phase === "sending") {
      title = "Switching preset…";
    } else if (data?.status.effect && compiling) {
      title = "Compiling shaders…";
      description = data.status.effect;
      if (data.status.pass_count > 0) {
        const pass = Math.min(data.status.pass_count, Math.max(0, data.status.pass));
        description += ` (${pass}/${data.status.pass_count})`;
        progress = pass / data.status.pass_count * 100;
      }
    }
  } else if (data?.status.state === "error") {
    error ||= data.status.reason || "Could not prepare the effects. Open Diagnostics for details.";
  } else if (data?.status.effects_active === false) {
    title = "Effects off";
  } else if (data?.presentation?.last_effect_presented_at !== undefined &&
      Date.now() - data.presentation.last_effect_presented_at >= 5000) {
    title = "Connected, waiting for game frames";
  } else if (data?.status.state === "waiting") {
    title = "Waiting for game frames";
    description = data.status.reason || "Resume the game to continue.";
  } else if (data?.status.state === "passthrough") {
    title = "Effects active";
    if (!data.active?.effects.length) {
      title = "Effects off";
    }
  }
  if (data?.stale) {
    description = "Waiting for the active renderer to update its status.";
    progress = undefined;
    title = "Waiting for game status";
  }
  if (!view.connected) {
    title = "Reconnecting…";
    description = "Waiting for the game connection.";
  }
  if (error) {
    title = "Could not apply the change";
    description = error;
  }

  return <div role={error ? "alert" : "status"} aria-live="polite" aria-busy={busy && !error}>
      <Field label={title} description={description || undefined} focusable highlightOnFocus
        icon={busy && !error ? <Spinner width={20} height={20} /> : undefined}
        childrenLayout="below" childrenContainerWidth="max" bottomSeparator="none">
        {busy && !error && <ProgressBar indeterminate={progress === undefined}
          nProgress={progress ?? 0} focusable={false} />}
      </Field>
    </div>;
}
