import { createContext } from "react";

export type SelfHostedSettings = {
  visiblePages?: string[];
  dashboardEditConfirmation: boolean;
  setDashboardEditConfirmation(value: boolean): void;
};

export const SelfHostedSettingsContext = createContext<SelfHostedSettings>({
  visiblePages: undefined,
  dashboardEditConfirmation: true,
  setDashboardEditConfirmation: () => {},
});
