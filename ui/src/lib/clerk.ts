// Clerk configuration. The publishable key identifies the Clerk instance (the shared
// iddofroom.co.il instance) and is public by design — safe to bake into the built bundle.
export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? ''

if (!CLERK_PUBLISHABLE_KEY) {
  console.warn('Missing VITE_CLERK_PUBLISHABLE_KEY — auth is disabled until it is set')
}
