# JavaScript and JSDoc standard

**Status:** Repository-wide engineering standard  
**Applies to:** Applications and packages in the Coinzilla workspace  
**Default:** JavaScript-first; JSDoc where it adds useful information

## 1. Language direction

Coinzilla uses modern JavaScript on the Node.js runtime and follows the repository's ECMAScript-module conventions. JavaScript is the default implementation language.

Do not introduce TypeScript source, a TypeScript build pipeline, project-wide TypeScript checking, or generated declaration files as an incidental refactor. A TypeScript migration or TypeScript-consumer compatibility commitment requires an explicit engineering decision with a defined scope and migration plan.

This policy does not prevent a future, deliberate TypeScript interoperability requirement. It keeps that requirement separate from the normal JavaScript development workflow.

## 2. What JSDoc is for

JSDoc comments are useful when they make a contract easier to understand or improve editor IntelliSense. They are not a requirement to narrate every line of code.

Use JSDoc for:
- Exported functions and classes whose parameter or return contract is not obvious.
- Options objects, nested data shapes, callback signatures, and event payloads.
- Non-obvious units, ranges, defaults, nullability, and invariants.
- Important error conditions or intentional exceptions.
- Shared typedefs that are reused within a cohesive domain.

Skip JSDoc when:
- A local variable's type is obvious from its initializer.
- A tiny private helper has a self-explanatory name and simple signature.
- A comment would merely repeat what the code already says.
- The annotation would duplicate a nearby schema or become a second, manually maintained source of truth.

Prefer a short accurate comment over a long speculative one.

## 3. Recommended syntax

Use standard JSDoc tags supported by common JavaScript language servers:

```js
/**
 * Wait for a bounded delay.
 *
 * @param {number} milliseconds - Delay in milliseconds; must be non-negative.
 * @returns {Promise<void>} Resolves after the delay.
 * @throws {TypeError|RangeError} If the delay is invalid or outside the supported range.
 */
export async function wait(milliseconds = 0) {
  // Implementation and runtime validation remain in JavaScript.
}
```

For an options object, describe the actual fields and whether they are optional:

```js
/**
 * Build a display label for an account.
 *
 * @param {object} options
 * @param {string} options.accountId
 * @param {string} [options.prefix]
 * @returns {string}
 */
export function createAccountLabel({ accountId, prefix = 'Account' }) {
  return `${prefix}: ${accountId}`
}
```

For a cohesive reusable shape, define a local typedef rather than repeating a complex inline type:

```js
/**
 * @typedef {object} RetryOptions
 * @property {number} attempts
 * @property {number} delayMs
 */

/**
 * @param {RetryOptions} options
 * @returns {Promise<void>}
 */
export async function retryOperation(options) {
  // ...
}
```

Examples are illustrative. Always document the real function signature, defaults, validation, and behavior in the file being changed.

## 4. Accuracy rules

- JSDoc must describe runtime behavior, not intended future behavior.
- Distinguish omitted properties from `undefined` and `null` when the API does.
- Document units explicitly (milliseconds, seconds, decimal strings, asset codes, and so on).
- Use `Promise<T>` for asynchronous return values and describe rejection conditions when useful.
- Do not claim a function throws a particular error unless the implementation can do so.
- Do not use `any` as a shortcut when a useful, accurate shape can be expressed. If the runtime contract is genuinely open-ended, say so explicitly.
- Update comments in the same change as the implementation. Tests verify behavior; comments do not.

## 5. Editor support and tooling

VS Code and many JavaScript language servers read JSDoc natively. A JavaScript project does not need to install the `jsdoc` package merely to get editor hints.

Install a JSDoc generator only when maintainers have decided to publish generated HTML/API documentation and have defined where it is built, reviewed, and hosted. Do not add a documentation build step or CI job just for autocomplete.

Do not enable `checkJs` globally or add `// @ts-check` across the repository by default. If static checking is later adopted, introduce it incrementally for a defined package or set of files, establish a baseline, and make its CI scope explicit.

## 6. TypeScript interoperability

JSDoc improves JavaScript editor support but does not automatically satisfy every TypeScript consumer. In particular, a TypeScript diagnostic such as `TS7016` means the consumer cannot find declarations for the imported JavaScript module.

If a TypeScript consumer becomes a supported package contract:
1. Identify the actual consumer(s) and the package entry points they import.
2. Decide whether to maintain accurate `.d.ts` declarations or generate them from a documented source workflow.
3. Keep declarations aligned with the runtime exports and test package resolution from a TypeScript consumer.
4. Do not use an empty `declare module '...'` declaration that silently turns the package into `any`, unless that loss of type safety is an explicitly accepted temporary migration measure.

Do not add declarations just to satisfy an editor diagnostic in a JavaScript-only project.

## 7. Review checklist

When reviewing a JavaScript change:
- [ ] Is the implementation still JavaScript and consistent with the package's module conventions?
- [ ] Are JSDoc comments present where they clarify a public or non-obvious contract?
- [ ] Are the types, defaults, units, nullability, and error conditions accurate?
- [ ] Have redundant or stale comments been avoided?
- [ ] Are runtime validation and automated tests still responsible for correctness?
- [ ] Has unnecessary TypeScript or documentation-generation tooling been avoided?
- [ ] If TypeScript consumers are in scope, are declarations accurate and package resolution tested?

## 8. Related standards

- [Engineering standards](../../ENGINEERING_STANDARDS.md)
- [Coding-agent instructions](../../AGENTS.md)
- [Mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md)
- [Utilities package instructions](../../packages/utils/AGENTS.md)
