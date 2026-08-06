import { createContext, useContext } from "react";

export type SelfHostedBackendCapabilities = {
  snapshotCheckpointRepairExecute: boolean;
};

export const BackendCapabilitiesContext = createContext<SelfHostedBackendCapabilities>({
  snapshotCheckpointRepairExecute: false,
});

export function useBackendCapabilities() {
  return useContext(BackendCapabilitiesContext);
}
