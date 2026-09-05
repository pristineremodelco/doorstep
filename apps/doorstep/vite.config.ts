import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath } from 'node:url'

// The workspace packages are TypeScript source, not built output. Aliasing them
// to their real paths keeps Vite compiling them as first-party code rather than
// treating a symlink under node_modules as a prebuilt dependency.
const at = (p: string) => fileURLToPath (new URL (p, import.meta.url))

// HTTPS is off by default and on for `npm run dev:lan`.
//
// getUserMedia refuses outside a secure context. localhost is the one origin
// exempt, so working on this machine needs no certificate, but a phone loading
// it over the LAN gets no camera and no error explaining why. A self-signed
// certificate fixes that: the phone warns once, you accept, and the origin
// counts as secure from then on. It is not the default because tooling that
// cannot be told to trust a self-signed certificate simply fails to connect.
const https = process.env.DOORSTEP_HTTPS === '1'

export default defineConfig ({
  plugins: [react (), ...(https ? [basicSsl ()] : [])],
  resolve: {
    alias: {
      '@doorstep/core': at ('../../packages/core/src/index.ts'),
      '@doorstep/ui': at ('../../packages/ui/src/index.ts'),
    },
  },
  server: {
    port: 5180,
    host: true,
    fs: { allow: [at ('../..')] },
  },
})
