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
      "no-nested-ternary": "error",
      "prefer-const": "error",
      "no-eval": "error",
      "no-new-func": "error",
      "no-alert": "error",
      "no-param-reassign": "error",
      "prefer-promise-reject-errors": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportDefaultDeclaration",
          message: "Use named exports; default exports are not allowed.",
        },
      ],

      // Complexity and function boundaries
      complexity: ["error", { max: 20 }],
      "max-params": ["error", 1],
      "max-lines-per-function": [
        "warn",
        {
          max: 80,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      "max-statements": ["warn", 50],
      "max-nested-callbacks": ["error", 3],

      // Correctness and maintainability
      "no-duplicate-imports": "error",
      "no-use-before-define": [
        "error",
        {
          functions: false,
          classes: true,
          variables: true,
        },
      ],
      "no-unreachable-loop": "error",
      "no-self-compare": "error",
      "no-throw-literal": "error",
      "preserve-caught-error": "error",
      "no-shadow": "error",
      "consistent-return": "error",
      "default-case": "error",
      "no-else-return": "error",
      "no-implicit-coercion": "warn",

      // Modern JavaScript
      "prefer-template": "error",
      "prefer-object-has-own": "error",
      "prefer-regex-literals": "error",
      "prefer-destructuring": "warn",
      "prefer-arrow-callback": "error",
      "object-shorthand": "error",
      "no-useless-concat": "error",
      "no-extra-bind": "error",
      "no-multi-assign": "error",
      "object-property-newline": ["error", { allowAllPropertiesOnSameLine: false }],

      // Defensive programming and security
      "no-implied-eval": "error",
      "no-extend-native": "error",
      "no-proto": "error",
      "no-script-url": "error",
      "no-new-wrappers": "error",
      radix: "error",
      "no-restricted-globals": [
        "error",
        {
          name: "event",
          message: "Use an explicitly passed event argument.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "arguments",
          property: "callee",
          message: "Do not use arguments.callee.",
        },
        {
          object: "arguments",
          property: "caller",
          message: "Do not use arguments.caller.",
        },
      ],

      // Debugging and logging
      "no-console": "warn",
      "symbol-description": "error",
    },
  },
  {
    files: ["eslint.config.js"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]);
