import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { readabilityConfigs } from "./scripts/eslint/readability-rules.mjs";

export default tseslint.config(
  { ignores: ["dist/**", "build/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  ...readabilityConfigs({ files: ["src/**/*.ts"] }),
);
