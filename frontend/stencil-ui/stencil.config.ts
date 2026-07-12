import { Config } from "@stencil/core";

export const config: Config = {
  namespace: "orchestraty-ui",
  outputTargets: [
    {
      type: "dist",
      esmLoaderPath: "../loader",
    },
    {
      type: "dist-custom-elements",
      customElementsExportBehavior: "auto-define-custom-elements",
    },
    {
      type: "docs-readme",
    },
  ],
  globalStyle: "src/global/variables.css",
};
