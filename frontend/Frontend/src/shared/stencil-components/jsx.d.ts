import type * as React from "react";

type CustomEl<P = Record<string, unknown>> = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement> & P,
  HTMLElement
>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "orc-spinner": CustomEl<{ size?: "sm" | "md" | "lg" }>;
      "orc-badge": CustomEl<{ variant?: "success" | "warning" | "danger" | "info" | "neutral"; dot?: boolean }>;
      "orc-stat-card": CustomEl<{ label?: string; value?: string; color?: string; subtitle?: string }>;
      "orc-progress-bar": CustomEl<{ value?: number | string; max?: number | string; label?: string }>;
    }
  }
}
