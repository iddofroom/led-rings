// Clerk configuration. The publishable key identifies the Clerk instance and is public by
// design (it's baked into every client bundle). We commit it as a fallback so any build — local
// or the friend's Pi — works with zero env config; VITE_CLERK_PUBLISHABLE_KEY overrides it.
// Instance: KivSee LED Studio (dev), Frontend API https://creative-bat-3.clerk.accounts.dev
const FALLBACK_PUBLISHABLE_KEY = 'pk_test_Y3JlYXRpdmUtYmF0LTMuY2xlcmsuYWNjb3VudHMuZGV2JA'

export const CLERK_PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || FALLBACK_PUBLISHABLE_KEY
