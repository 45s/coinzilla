import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";

export default defineConfig([
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/generated/**",
      "**/vendor/**",
      "**/logs/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: {
      js,
    },
    extends: ["js/recommended"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.nodeBuiltin,
    },
    rules: {
      eqeqeq: ["error", "always", { null: "ignore" }],
      curly: ["error", "all"],
      "prefer-const": "error",
      "no-eval": "error",
      "no-new-func": "error",
      "no-alert": "error",
      "no-param-reassign": "error",
      "prefer-promise-reject-errors": "error",
    },
  },
]);
