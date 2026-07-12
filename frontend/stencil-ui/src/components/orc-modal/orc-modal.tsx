import { Component, Prop, Event, EventEmitter, h } from "@stencil/core";

@Component({ tag: "orc-modal", styleUrl: "orc-modal.css", shadow: true })
export class OrcModal {
  @Prop({ mutable: true, reflect: true }) open = false;
  @Prop() heading = "";
  @Event() modalClose!: EventEmitter<void>;

  private handleOverlayClick = () => {
    this.open = false;
    this.modalClose.emit();
  };

  render() {
    if (!this.open) return null;
    return (
      <div class="overlay" onClick={this.handleOverlayClick}>
        <div class="modal" onClick={(e: Event) => e.stopPropagation()}>
          <div class="modal__header">
            <h2>{this.heading}</h2>
            <button class="modal__close" onClick={this.handleOverlayClick}>&times;</button>
          </div>
          <div class="modal__body">
            <slot />
          </div>
        </div>
      </div>
    );
  }
}
