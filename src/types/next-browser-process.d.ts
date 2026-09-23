/**
 * `next/dist/build/polyfills/process` is what Next substitutes for the bare `process`
 * specifier in client bundles. It ships without type declarations; only `env` is used here.
 */
declare module 'next/dist/build/polyfills/process' {
  const browserProcess: {
    env: Record<string, string | undefined>
  }
  export default browserProcess
}
