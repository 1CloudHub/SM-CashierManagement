/**
 * Component gallery / design-system reference (task 1.10 — SG-000/001, UX-010).
 *
 * The living style-guide reference: a navigable page documenting every token,
 * primitive, state, layout and pattern built in tasks 1.4–1.9, composed from
 * the same primitives it documents. `ComponentGallery` is the mounted root
 * (providers + AppShell + section index); each section is exported too so it
 * can be embedded elsewhere (docs, tests) without the whole shell.
 */
export { ComponentGallery } from './component-gallery'
export { GALLERY_SECTIONS, type GallerySection } from './gallery-nav'
export { FoundationsSection } from './section-foundations'
export { PrimitivesSection } from './section-primitives'
export { StatesSection } from './section-states'
export { LayoutSection } from './section-layout'
export { PatternsSection } from './section-patterns'
export { ErrorsSection } from './section-errors'
