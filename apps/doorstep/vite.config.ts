import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

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

// Stamped at build time and written to two places: into the bundle, so the
// running app knows which build it is, and into version.json, so it can ask the
// server what is being served now. Comparing those two is what notices an
// update, rather than trusting a service worker that may itself be stale.
const BUILD = new Date ().toISOString ().replace (/[-:TZ.]/g, '').slice (0, 14)

export default defineConfig ({
  define: { 'import.meta.env.VITE_BUILD': JSON.stringify (BUILD) },
  plugins: [
    react (),
    ...(https ? [basicSsl ()] : []),
    {
      name: 'doorstep-version-file',
      closeBundle () {
        writeFileSync (
          at ('./dist/version.json'),
          JSON.stringify ({ build: BUILD, at: new Date ().toISOString () })
        )
      },
    },
  ],
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
