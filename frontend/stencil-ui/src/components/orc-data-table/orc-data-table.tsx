import { Component, Prop, State, h } from "@stencil/core";

@Component({ tag: "orc-data-table", styleUrl: "orc-data-table.css", shadow: true })
export class OrcDataTable {
  @Prop() columns = "[]";
  @Prop() sortable = true;
  @State() sortCol = "";
  @State() sortDir: "asc" | "desc" = "asc";

  private get cols(): string[] {
    try { return JSON.parse(this.columns); } catch { return []; }
  }

  private handleSort(col: string) {
    if (!this.sortable) return;
    if (this.sortCol === col) {
      this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
    } else {
      this.sortCol = col;
      this.sortDir = "asc";
    }
  }

  render() {
    return (
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              {this.cols.map((col) => (
                <th onClick={() => this.handleSort(col)} class={this.sortable ? "sortable" : ""}>
                  {col}
                  {this.sortCol === col && <span class="sort-arrow">{this.sortDir === "asc" ? " \u2191" : " \u2193"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <slot />
          </tbody>
        </table>
      </div>
    );
  }
}
