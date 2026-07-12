import { Component, Prop, h } from "@stencil/core";

@Component({ tag: "orc-badge", styleUrl: "orc-badge.css", shadow: true })
export class OrcBadge {
  @Prop() variant: "success" | "warning" | "danger" | "info" | "neutral" = "neutral";
  @Prop() dot = false;

  render() {
    return (
      <span class={`badge badge--${this.variant}`}>
        {this.dot && <span class="dot" />}
        <slot />
      </span>
    );
  }
}
