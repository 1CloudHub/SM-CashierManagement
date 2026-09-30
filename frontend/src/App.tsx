import { ComponentGallery } from '@/components/gallery'

/**
 * App root — the component gallery / design-system reference (task 1.10,
 * SG-000/001, UX-010).
 *
 * Until the application screens land (task 4+), the app root renders the
 * living style-guide reference: a real, navigable gallery documenting every
 * primitive, state, layout and pattern built in tasks 1.4–1.9, composed from
 * the same token-driven primitives it documents. It doubles as the render
 * smoke test for the token layer + Tailwind mapping and carries the automated
 * axe check (App.test.tsx). The gallery owns its own providers (I18n,
 * Announcer, Toast, Help/keyboard) via `ComponentGallery`.
 */
export function App() {
  return <ComponentGallery />
}
