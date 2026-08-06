import { HealthView } from "@common/features/health/components/HealthView";
import { DisclosureSection } from "@common/features/health/components/HealthView";
import { SelfHostedInsights } from "../components/health/SelfHostedInsights";

export default function Page() {
  return (
    <HealthView
      header={<h3 className="sticky top-0 mx-6 pt-4 pb-2">Health</h3>}
      PagesWrapper={({ children }) => (
        <div className="flex min-h-0 grow">{children}</div>
      )}
      PageWrapper={({ children }) => (
        <div className="scrollbar max-w-full shrink-0 grow overflow-y-auto px-6 pb-4">
          <DisclosureSection
            id="insights"
            title="Insights"
            defaultOpen
            closedDescription={
              <span className="text-xs text-content-secondary">
                self-hosted buffered and durable-history evidence
              </span>
            }
          >
            <SelfHostedInsights />
          </DisclosureSection>
          {children}
        </div>
      )}
    />
  );
}
