import 'dotenv/config';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { metalootAuth } from '@metaloot/auth/node';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8741;
const REDIRECT_URI =
  process.env.METALOOT_REDIRECT_URI ||
  'https://nebula-run-production.up.railway.app/auth/metaloot/callback';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const app = express();

// Railway terminates HTTPS before Node; trust it so the adapter can detect
// forwarded HTTPS and emit SameSite=None; Secure cookies in production.
app.set('trust proxy', 1);

app.use(
  metalootAuth({
    clientId: requireEnv('METALOOT_CLIENT_ID'),
    clientSecret: requireEnv('METALOOT_CLIENT_SECRET'),
    sessionSecret: requireEnv('METALOOT_SESSION_SECRET'),
    redirectUri: REDIRECT_URI,
  }),
);

app.use('/vendor/@metaloot/auth', express.static(join(ROOT, 'node_modules/@metaloot/auth/dist')));
app.use(
  express.static(ROOT, {
    etag: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

app.use((req, res) => {
  res.status(404).type('text/plain').send('not found');
});

app.listen(PORT, () => {
  console.log(`Nebula Run at http://localhost:${PORT}`);
});
