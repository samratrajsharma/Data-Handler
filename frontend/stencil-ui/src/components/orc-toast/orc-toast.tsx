import { Component, Prop, State, Watch, h } from "@stencil/core";

@Component({ tag: "orc-toast", styleUrl: "orc-toast.css", shadow: true })
export class OrcToast {
  @Prop() variant: "success" | "error" | "info" = "info";
  @Prop() duration = 4000;
  @Prop({ mutable: true, reflect: true }) open = false;
  @State() visible = false;

  @Watch("open")
  onOpenChange(val: boolean) {
    if (val) {
      this.visible = true;
      if (this.duration > 0) {
        setTimeout(() => { this.visible = false; this.open = false; }, this.duration);
      }
    } else {
      this.visible = false;
    }
  }

  render() {
    if (!this.visible) return null;
    return (
      <div class={`toast toast--${this.variant}`}>
        <slot />
      </div>
    );
  }
}
