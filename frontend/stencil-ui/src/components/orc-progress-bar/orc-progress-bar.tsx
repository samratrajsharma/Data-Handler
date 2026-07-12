import { Component, Prop, h } from "@stencil/core";

@Component({ tag: "orc-progress-bar", styleUrl: "orc-progress-bar.css", shadow: true })
export class OrcProgressBar {
  @Prop() value = 0;
  @Prop() max = 100;
  @Prop() label = "";

  render() {
    const pct = Math.min((this.value / this.max) * 100, 100);
    return (
      <div class="progress-wrap">
        <div class="progress-bar">
          <div class="progress-bar__fill" style={{ width: `${pct}%` }} />
        </div>
        {this.label && <span class="progress-label">{this.label}</span>}
      </div>
    );
  }
}
