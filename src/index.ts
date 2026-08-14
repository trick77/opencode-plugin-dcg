export { DcgPlugin } from './plugin.ts'
// `export type *`, not `export *`: opencode's plugin loader iterates
// Object.values() of this module and throws "Plugin export is not a function"
// on any runtime export that is not a plugin. types.ts is deliberately
// type-only so there is nothing for a re-export to leak, and the type form is
// erased at compile time — belt and braces, since a value added to types.ts
// later would otherwise reach the loader through here.
export type * from './types.ts'
