import React, { ReactNode, ErrorInfo } from "react";
import { Button } from "@ui/Button";
import { Sheet } from "@ui/Sheet";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error?: Error;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {};
  }

  static getDerivedStateFromError(e: Error): ErrorBoundaryState {
    return { error: e };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    const { error } = this.state;
    const { children } = this.props;
    if (error) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center gap-4">
          <h3>Something went wrong</h3>
          <div className="flex flex-col items-center gap-2">
            {error.message.includes("not permitted") && (
              <p role="alert" className="text-sm">
                Your admin key may be invalid. Please try logging in again.
              </p>
            )}
            <Button
              className="w-fit"
              size="xs"
              onClick={() => {
                window.location.reload();
              }}
              variant="neutral"
            >
              Retry
            </Button>
          </div>
          <Sheet className="max-h-[50vh] w-200 max-w-[80vw] overflow-auto font-mono text-sm">
            {error.message}
            <pre>
              <code>{error.stack}</code>
            </pre>
          </Sheet>
        </div>
      );
    }

    return children;
  }
}
