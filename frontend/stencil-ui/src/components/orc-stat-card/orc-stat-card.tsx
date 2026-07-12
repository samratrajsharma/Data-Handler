import { Component, Prop, h } from "@stencil/core";

@Component({ tag: "orc-stat-card", styleUrl: "orc-stat-card.css", shadow: true })
export class OrcStatCard {
  @Prop() label = "";
  @Prop() value = "";
  @Prop() color = "var(--orc-primary)";
  @Prop() subtitle = "";

  render() {
    return (
      <div class="stat-card">
        <div class="stat-card__label">{this.label}</div>
        <div class="stat-card__value" style={{ color: this.color }}>{this.value}</div>
        {this.subtitle && <div class="stat-card__sub">{this.subtitle}</div>}
      </div>
    );
  }
}
