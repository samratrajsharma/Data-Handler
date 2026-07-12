import { Component, Prop, h } from "@stencil/core";

@Component({ tag: "orc-button", styleUrl: "orc-button.css", shadow: true })
export class OrcButton {
  @Prop() variant: "primary" | "secondary" | "danger" = "primary";
  @Prop() size: "sm" | "md" | "lg" = "md";
  @Prop({ reflect: true }) disabled = false;
  @Prop() loading = false;

  render() {
    return (
      <button
        class={`btn btn--${this.variant} btn--${this.size}`}
        disabled={this.disabled || this.loading}
      >
        {this.loading && <span class="spinner" />}
        <slot />
      </button>
    );
  }
}
