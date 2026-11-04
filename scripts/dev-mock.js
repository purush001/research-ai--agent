// Runs the app against mock OpenAI/SerpAPI servers (no real keys or network
// needed): `npm run dev:mock`, then enter any API key such as "sk-demo" / "demo".
import { spawn } from 'node:child_process';
import { startMockProviders } from '../test/mock-providers.js';

const mock = await startMockProviders({ port: 8799 });
console.log(`[mock] providers listening on ${mock.url} (keys containing "bad" -> 401, "ratelimit" -> 429)`);
const child = spawn('npx', ['vite', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, OPENAI_BASE_URL: `${mock.url}/v1`, SERPAPI_BASE_URL: mock.url },
});
child.on('exit', (code) => process.exit(code ?? 0));
