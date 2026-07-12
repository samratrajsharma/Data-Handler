import { Component, Prop, h } from "@stencil/core";

@Component({ tag: "orc-spinner", styleUrl: "orc-spinner.css", shadow: true })
export class OrcSpinner {
  @Prop() size: "sm" | "md" | "lg" = "md";

  render() {
    // Renders the Orchestraty logo as the spinning element instead of a
    // generic circle-with-arc — every loading state in the app shows the
    // brand mark spinning.
    return (
      <img
        src="/orchestraty-icon.svg"
        alt="Loading"
        class={`spinner spinner--${this.size}`}
      />
    );
  }
}
