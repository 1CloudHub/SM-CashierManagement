import type { ElementType, ComponentPropsWithoutRef } from 'react'

/**
 * Small, correctly-typed polymorphic helper for the layout primitives.
 *
 * Each primitive renders a plain layout element by default (`div`, `section`,
 * `ul`, …) but lets a screen swap the tag with `as` so the DOM stays semantic
 * (e.g. a `Stack` that is really a `<ul>`, a `Cluster` that is a `<nav>`).
 *
 * The key correctness point (and the reason an earlier attempt failed
 * `tsc -b`): the accepted attributes must follow the *chosen* element, not a
 * fixed `HTMLDivElement`. Spreading div attributes onto a `ul`/`nav`/`form`
 * is what tsc rejected. `PolymorphicProps<E, P>` derives the attribute set from
 * `E` via `ComponentPropsWithoutRef<E>`, so `as="ul"` only accepts `<ul>`
 * attributes and `as="form"` only accepts `<form>` attributes.
 *
 * `E extends ElementType` keeps the tag constrained to real elements/components
 * and `Omit<…, keyof P | 'as'>` prevents the element's own attributes from
 * clashing with a primitive's own props.
 */
export type PolymorphicProps<
  E extends ElementType,
  P = object,
> = P & {
  /** The element or component to render. Defaults per primitive. */
  as?: E
} & Omit<ComponentPropsWithoutRef<E>, keyof P | 'as'>
