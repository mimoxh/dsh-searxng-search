/**
 * Offline smoke test for dsh-searxng-search.
 *
 *   node test/smoke.mjs   (or: npm test)
 *
 * Runs the plugin's own `apply()` against a stub ctx, maps a real
 * SearXNG-shaped JSON body, and exercises one GET round trip against an
 * in-process mock SearXNG (no network, no DSH install, no dependencies).
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import {
	apply,
	buildSearchUrl,
	createProvider,
	mapSearxngResponse,
	name,
	inject,
	SEARXNG_PROVIDER_ID
} from '../index.js'

const results = []
function check(label, fn) {
	try {
		fn()
		results.push(`PASS  ${label}`)
	} catch (error) {
		results.push(`FAIL  ${label}\n      ${error.message}`)
		process.exitCode = 1
	}
}
async function checkAsync(label, fn) {
	try {
		await fn()
		results.push(`PASS  ${label}`)
	} catch (error) {
		results.push(`FAIL  ${label}\n      ${error.message}`)
		process.exitCode = 1
	}
}

const SEARXNG_BODY = {
	query: 'deepseek harness',
	number_of_results: 3,
	answers: ['DeepSeek Harness is a coding agent.'],
	results: [
		{ url: 'https://github.com/deepseek-ai/deepseek-harness', title: 'deepseek-harness', content: 'Coding agent harness.', publishedDate: '2026-01-02T00:00:00', engine: 'github' },
		{ url: 'https://github.com/deepseek-ai/deepseek-harness', title: 'duplicate', content: 'dup', engine: 'bing' },
		{ url: 'https://example.com/docs', title: 'Docs', content: 'Reference.', engine: 'google' },
		{ url: '', title: 'no url', engine: 'google' },
		{ url: 'https://example.com/plain', engine: 'google' },
		null
	]
}

check('plugin declares seam injection', () => {
	assert.deepEqual(inject, ['web'])
	assert.equal(name, 'web-search-searxng')
})

check('apply() registers a provider under the "searxng" id', () => {
	let captured
	const ctx = { web: { registerSearchProvider(provider) { captured = provider } } }
	apply(ctx, { baseURL: 'http://searxng.lan:8888/' })
	assert.ok(captured, 'apply must register a provider')
	assert.equal(captured.id, SEARXNG_PROVIDER_ID)
	assert.equal(captured.id, 'searxng')
	assert.equal(captured.available(), true)
})

check('available() is false without a parsable baseURL', () => {
	const provider = createProvider({})
	assert.equal(provider.available(), false)
	assert.equal(createProvider({ baseURL: 'not a url' }).available(), false)
	assert.equal(createProvider({ baseURL: 'http://127.0.0.1:8888' }).available(), true)
})

check('baseURL trailing slashes are trimmed and apiPath is normalized', () => {
	const url = buildSearchUrl(createProvider({ baseURL: 'http://searxng.lan:8888///', apiPath: 'searxng/search/' }).options, 'hello world')
	assert.equal(url.origin + url.pathname, 'http://searxng.lan:8888/searxng/search')
	assert.equal(url.searchParams.get('q'), 'hello world')
	assert.equal(url.searchParams.get('format'), 'json')
	assert.equal(url.searchParams.get('pageno'), '1')
})

check('fixed preferences become query parameters', () => {
	const provider = createProvider({
		baseURL: 'http://searxng.lan:8888',
		language: 'zh-CN',
		categories: 'general,news',
		engines: 'google,bing',
		timeRange: 'month',
		safeSearch: 2
	})
	const url = buildSearchUrl(provider.options, 'test')
	assert.equal(url.searchParams.get('language'), 'zh-CN')
	assert.equal(url.searchParams.get('categories'), 'general,news')
	assert.equal(url.searchParams.get('engines'), 'google,bing')
	assert.equal(url.searchParams.get('time_range'), 'month')
	assert.equal(url.searchParams.get('safesearch'), '2')
})

check('mapSearxngResponse dedupes, drops empty urls, keeps answers and caps', () => {
	const result = mapSearxngResponse(SEARXNG_BODY, 2)
	assert.equal(result.sources.length, 2)
	assert.deepEqual(result.sources[0], {
		url: 'https://github.com/deepseek-ai/deepseek-harness',
		title: 'deepseek-harness',
		snippet: 'Coding agent harness.',
		publishedAt: '2026-01-02T00:00:00'
	})
	assert.equal(result.sources[1].url, 'https://example.com/docs')
	assert.equal(result.content, 'DeepSeek Harness is a coding agent.')
	assert.equal(result.truncated, true)
})

check('mapSearxngResponse tolerates a partial payload', () => {
	const result = mapSearxngResponse({ query: 'x', results: [{ url: 'https://a.test', published_date: '2026-05-05' }] }, 10)
	assert.deepEqual(result.sources, [{ url: 'https://a.test', publishedAt: '2026-05-05' }])
	assert.equal(result.content, undefined)
	assert.equal(result.truncated, false)
})

check('section-backed config refs are unwrapped', () => {
	const provider = createProvider({
		baseURL: { get: () => 'http://searxng.lan:8888' },
		timeoutMs: { get: () => 5000 },
		language: { get: () => 'zh-CN' }
	})
	assert.equal(provider.available(), true)
	assert.equal(provider.options.timeoutMs, 5000)
	assert.equal(provider.options.language, 'zh-CN')
})

check('the default user agent carries the package version', () => {
	const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
	const provider = createProvider({ baseURL: 'http://searxng.example:8888' })
	assert.equal(provider.options.userAgent, `dsh-searxng-search/${version}`)
})

await checkAsync('search() performs one GET against the configured instance', async () => {
	let seen
	const server = http.createServer((req, res) => {
		seen = { url: req.url, headers: req.headers, method: req.method }
		res.writeHead(200, { 'content-type': 'application/json' })
		res.end(JSON.stringify(SEARXNG_BODY))
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address()
	try {
		const provider = createProvider({ baseURL: `http://127.0.0.1:${port}`, language: 'zh-CN' })
		const result = await provider.search({ query: 'deepseek harness', maxResults: 5 }, undefined)
		assert.equal(seen.method, 'GET')
		assert.equal(seen.url, '/search?q=deepseek+harness&format=json&pageno=1&language=zh-CN')
		assert.equal(seen.headers.accept, 'application/json')
		assert.equal(seen.headers['user-agent'], 'dsh-searxng-search/0.1.0')
		assert.equal(result.sources.length, 3)
		assert.equal(result.sources[0].url, 'https://github.com/deepseek-ai/deepseek-harness')
		assert.equal(result.truncated, false)
	} finally {
		await new Promise((resolve) => server.close(resolve))
	}
})

await checkAsync('an HTML response is a clear JSON-API error, not a silent empty result', async () => {
	const server = http.createServer((req, res) => {
		res.writeHead(200, { 'content-type': 'text/html' })
		res.end('<!doctype html><html><body>SearXNG</body></html>')
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address()
	try {
		const provider = createProvider({ baseURL: `http://127.0.0.1:${port}` })
		await assert.rejects(
			() => provider.search({ query: 'x' }, undefined),
			(error) => {
				assert.equal(error.code, 'WEB_PROVIDER_ERROR')
				assert.match(error.message, /formats: \[html, json\]/u)
				return true
			}
		)
	} finally {
		await new Promise((resolve) => server.close(resolve))
	}
})

await checkAsync('a 429 becomes a limiter-oriented error', async () => {
	const server = http.createServer((req, res) => {
		res.writeHead(429, { 'content-type': 'text/plain' })
		res.end('Too Many Requests')
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address()
	try {
		const provider = createProvider({ baseURL: `http://127.0.0.1:${port}` })
		await assert.rejects(
			() => provider.search({ query: 'x' }, undefined),
			(error) => {
				assert.equal(error.code, 'WEB_PROVIDER_ERROR')
				assert.match(error.message, /limiter/u)
				return true
			}
		)
	} finally {
		await new Promise((resolve) => server.close(resolve))
	}
})

await checkAsync('a 403 names the disabled JSON format as the likely cause', async () => {
	const server = http.createServer((req, res) => {
		res.writeHead(403, { 'content-type': 'text/html' })
		res.end('')
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address()
	try {
		const provider = createProvider({ baseURL: `http://127.0.0.1:${port}` })
		await assert.rejects(
			() => provider.search({ query: 'x' }, undefined),
			(error) => {
				assert.equal(error.code, 'WEB_PROVIDER_ERROR')
				assert.match(error.message, /HTTP 403/u)
				assert.match(error.message, /search\.formats/u)
				return true
			}
		)
	} finally {
		await new Promise((resolve) => server.close(resolve))
	}
})

await checkAsync('an already-aborted signal reports WEB_ABORTED', async () => {
	const provider = createProvider({ baseURL: 'http://127.0.0.1:1' })
	await assert.rejects(
		() => provider.search({ query: 'x' }, AbortSignal.abort(new Error('cancelled'))),
		(error) => {
			assert.equal(error.code, 'WEB_ABORTED')
			return true
		}
	)
})

await checkAsync('an unreachable instance fails with the endpoint in the message', async () => {
	const provider = createProvider({ baseURL: 'http://127.0.0.1:1', timeoutMs: 1000 })
	await assert.rejects(
		() => provider.search({ query: 'x' }, undefined),
		(error) => {
			assert.equal(error.code, 'WEB_PROVIDER_ERROR')
			assert.match(error.message, /127\.0\.0\.1:1/u)
			return true
		}
	)
})

console.log(results.join('\n'))
console.log(process.exitCode === 1 ? '\nSMOKE TEST FAILED' : '\nSMOKE TEST PASSED')
