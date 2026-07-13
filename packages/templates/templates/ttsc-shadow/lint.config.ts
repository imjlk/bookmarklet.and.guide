import type { ITtscLintConfig } from "@ttsc/lint";

export default {
  format: {
    printWidth: 96,
    severity: "error",
    sortImports: {
      order: ["<BUILTIN_MODULES>", "", "<THIRD_PARTY_MODULES>", "", "^@app/", "^[./]"],
    },
    trailingComma: "all",
  },
  rules: {
    eqeqeq: "error",
    "no-var": "error",
    "prefer-const": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-floating-promises": "error",
  },
} satisfies ITtscLintConfig;
