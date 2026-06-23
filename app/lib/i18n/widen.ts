/** Widen const object literal types to plain strings/records so tr/en can diverge. */
export type Widen<T> = T extends string
  ? string
  : T extends number
  ? number
  : T extends boolean
  ? boolean
  : T extends (...args: infer A) => infer R
  ? (...args: A) => Widen<R>
  : T extends readonly (infer U)[]
  ? U[]
  : T extends object
  ? { [K in keyof T]: Widen<T[K]> }
  : T;
