import { ipc } from "@/ipc/types";

export function AutoUpdateSwitch() {
  return (
    <div className="text-sm text-muted-foreground">
      Personal builds update manually from{" "}
      <button
        className="underline"
        onClick={() =>
          ipc.system.openExternalUrl(
            "https://github.com/Self-Command/dyad-personal/releases",
          )
        }
      >
        Personal Releases
      </button>
      .
    </div>
  );
}
