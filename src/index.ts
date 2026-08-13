export { DcgPlugin } from './plugin.ts'
// `export type *`, not `export *`: opencode's plugin loader iterates
// Object.values() of this module and throws "Plugin export is not a function"
// on any runtime export that is not a plugin. types.ts exports a value
// (PASSING_DECISIONS), and the type form is erased at compile time.
export type * from './types.ts'
