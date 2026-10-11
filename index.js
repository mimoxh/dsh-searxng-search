/**
 * SearXNG search provider for the DSH web capability seam (`ctx.web`).
 *
 * Mounted by `cordis.patch.yml`; once `@deepseek-ai/dsh-web` pins
 * `searchProvider: searxng`, the model-facing `web_search` tool from
 * `@deepseek-ai/dsh-tool-web` runs its queries against an internal SearXNG
 * instance through `GET <baseURL><apiPath>?q=…&format=json`.
 *
 * This module intentionally has **no imports**: it runs inside the DSH host
 * process and only uses Node globals (`fetch`, `URL`, `URLSearchParams`,
 * `AbortSignal`), so it does not depend on how the loader resolves packages
 * shipped inside the DSH installation.
 *
 * @module dsh-searxng-search
 */

/** Plugin name used by loader diagnostics. */
export const name = 'web-search-searxng'

/** The seam this provider registers into; `dsh-web` must be mounted first. */
export const inject = ['web']

/** Provider id pinned through the `@deepseek-ai/dsh-web` row (`searchProvider: searxng`). */
export const SEARXNG_PROVIDER_ID = 'searxng'

/**
 * Version reported in the default `User-Agent`. It is duplicated here because
 * this module deliberately imports nothing; `test/smoke.mjs` fails when it
 * drifts away from `package.json`.
 */
const PACKAGE_VERSION = '0.2.0'

/** SearXNG refuses requests without a `User-Agent`. */
const DEFAULT_USER_AGENT = `dsh-searxng-search/${PACKAGE_VERSION}`

const DEFAULT_API_PATH = '/search'
const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_MAX_RESULTS = 10
const MAX_ERROR_BODY_CHARS = 400

/**
 * Build the error shape the seam's consumers route on: a `code` property plus a
 * message that names the endpoint and the recovery step. `WebError` is not
 * imported on purpose (see the module note); the tool layer only reads the
 * message and any `code` it finds.
 *
 * @param message - human-readable failure, including the resolved endpoint.
 * @param code - machine-routable code; `WEB_PROVIDER_ERROR` unless cancelling.
 * @param cause - the underlying error, when any.
 * @returns the error to throw.
 */
export function webError(message, code = 'WEB_PROVIDER_ERROR', cause) {
	const error = new Error(message)
	error.name = 'WebError'
	error.code = code
	if (cause !== undefined) error.cause = cause
	return error
}

/** Narrow one config value to a trimmed non-empty string, else `undefined`. */
function text(value) {
	if (typeof value !== 'string') return undefined
	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : undefined
}

/** Positive integer from config, else the fallback. */
function positiveInteger(value, fallback) {
	return Number.isInteger(value) && value > 0 ? value : fallback
}

/** `0` | `1` | `2` (SearXNG's `safesearch` vocabulary), else `undefined`. */
function safeSearch(value) {
	if (value === 0 || value === 1 || value === 2) return String(value)
	const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
	return parsed === 0 || parsed === 1 || parsed === 2 ? String(parsed) : undefined
}

/** Normalize `apiPath` to a leading slash and no trailing slash. */
function normalizeApiPath(value) {
	const raw = text(value) ?? DEFAULT_API_PATH
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`
	return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash
}

/** Extra request headers: string → string, with a valid header name. */
function headerRecord(value) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
	const headers = {}
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw !== 'string' || raw.length === 0) continue
		try {
			new Headers({ [key]: raw })
		} catch {
			continue
		}
		headers[key] = raw
	}
	return headers
}

/**
 * Read one config field, unwrapping a section-backed ref (`.get()`) when the
 * loader hands one over instead of a plain value. This plugin declares no
 * schema, so values normally arrive plain; the unwrap is a cheap hedge that
 * keeps the provider working if that ever changes.
 */
function field(container, key) {
	const value = container === null || typeof container !== 'object' ? undefined : container[key]
	return value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
}

/**
 * Project one plugin row's `config` into the values a search actually reads.
 * Every field is optional except `baseURL`, which also falls back to the
 * `SEARXNG_BASE_URL` environment variable of the launching process.
 *
 * @param raw - the row's `config` object (plain, unvalidated).
 * @returns frozen provider options.
 */
export function normalizeConfig(raw) {
	const config = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
	const baseURL = (text(field(config, 'baseURL')) ?? text(process.env.SEARXNG_BASE_URL) ?? '').replace(/\/+$/u, '')
	return Object.freeze({
		baseURL,
		apiPath: normalizeApiPath(field(config, 'apiPath')),
		language: text(field(config, 'language')),
		categories: text(field(config, 'categories')),
		engines: text(field(config, 'engines')),
		timeRange: text(field(config, 'timeRange')),
		safeSearch: safeSearch(field(config, 'safeSearch')),
		timeoutMs: positiveInteger(field(config, 'timeoutMs'), DEFAULT_TIMEOUT_MS),
		maxResults: positiveInteger(field(config, 'maxResults'), DEFAULT_MAX_RESULTS),
		userAgent: text(field(config, 'userAgent')) ?? DEFAULT_USER_AGENT,
		headers: headerRecord(field(config, 'headers'))
	})
}

/**
 * Build the `GET` URL for one query. Only provider-neutral controls the seam
 * exposes are forwarded (`query`), plus this deployment's fixed preferences.
 *
 * @param options - normalized provider options.
 * @param query - the search query.
 * @returns the absolute request URL.
 */
export function buildSearchUrl(options, query) {
	const url = new URL(`${options.baseURL}${options.apiPath}`)
	url.searchParams.set('q', query)
	url.searchParams.set('format', 'json')
	url.searchParams.set('pageno', '1')
	if (options.language !== undefined) url.searchParams.set('language', options.language)
	if (options.categories !== undefined) url.searchParams.set('categories', options.categories)
	if (options.engines !== undefined) url.searchParams.set('engines', options.engines)
	if (options.timeRange !== undefined) url.searchParams.set('time_range', options.timeRange)
	if (options.safeSearch !== undefined) url.searchParams.set('safesearch', options.safeSearch)
	return url
}

/** `publishedDate` across SearXNG versions (`publishedDate`, `published_date`, `pubdate`). */
function publishedAtOf(item) {
	for (const key of ['publishedDate', 'published_date', 'pubdate']) {
		const value = item[key]
		if (typeof value === 'string' && value.trim().length > 0) return value.trim()
	}
	return undefined
}

/**
 * Map a SearXNG `/search?format=json` body to the seam's result vocabulary:
 * deduplicated `sources[]` (`url`, `title`, `snippet`, `publishedAt`), an
 * optional `content` from SearXNG's direct `answers[]`, and `truncated`.
 * Results without a URL are dropped.
 *
 * @param payload - the parsed JSON body.
 * @param maxResults - this deployment's own cap, applied before the seam caps again.
 * @returns the normalized search result.
 */
export function mapSearxngResponse(payload, maxResults) {
	const raw = payload !== null && typeof payload === 'object' && Array.isArray(payload.results) ? payload.results : []
	const seen = new Set()
	const sources = []
	for (const item of raw) {
		if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
		const url = text(item.url)
		if (url === undefined || seen.has(url)) continue
		seen.add(url)
		const title = text(item.title)
		const snippet = text(item.content)
		const publishedAt = publishedAtOf(item)
		sources.push({
			url,
			...title !== undefined ? { title } : {},
			...snippet !== undefined ? { snippet } : {},
			...publishedAt !== undefined ? { publishedAt } : {}
		})
	}
	const answers = Array.isArray(payload?.answers) ? payload.answers.filter((answer) => typeof answer === 'string' && answer.trim().length > 0) : []
	const cap = Number.isInteger(maxResults) && maxResults > 0 ? maxResults : undefined
	const capped = cap !== undefined && sources.length > cap ? sources.slice(0, cap) : sources
	return {
		...answers.length > 0 ? { content: answers.join('\n') } : {},
		sources: capped,
		truncated: capped.length < sources.length
	}
}

/** Read a short, safe preview of an error response body. */
async function readErrorBody(response) {
	try {
		const body = await response.text()
		const preview = body.replace(/\s+/gu, ' ').trim().slice(0, MAX_ERROR_BODY_CHARS)
		return preview.length > 0 ? `: ${preview}` : ''
	} catch {
		return ''
	}
}

/** Recovery guidance keyed by the HTTP status SearXNG or a proxy in front of it returns. */
function statusHint(status) {
	if (status === 403) return ' SearXNG answers a `format=json` request with 403 when the JSON output format is not enabled: add `json` under `search.formats` in SearXNG\'s settings.yml and restart SearXNG. If HTML search works while only `format=json` is refused, this is the cause; otherwise the refusal comes from `server.limiter` / `botdetection`, so allow this host\'s address.'
	if (status === 429) return ' SearXNG is rate-limiting this host: check `server.limiter` / `botdetection` in SearXNG\'s settings.yml and allow this host\'s address.'
	if (status === 404) return ' Check `baseURL` and `apiPath` (the JSON API lives at `<baseURL>/search`).'
	return ''
}

/** Combine the caller's signal with the provider's own timeout budget. */
function requestSignal(signal, timeoutMs) {
	const timeout = AbortSignal.timeout(timeoutMs)
	if (signal === undefined) return timeout
	return AbortSignal.any([signal, timeout])
}

/**
 * The SearXNG-backed search provider. Every search resolves its URL from the
 * configured base URL only, so it never becomes a generic internal HTTP proxy.
 */
export class SearxngSearchProvider {
	/** @param options - the normalized options from one plugin row. */
	constructor(options) {
		this.options = options
		/** Registry key; pin it with `@deepseek-ai/dsh-web`'s `searchProvider`. */
		this.id = SEARXNG_PROVIDER_ID
	}

	/**
	 * Availability is a cheap local check, never a network call: a parsable
	 * `baseURL` and a positive timeout are all a search needs.
	 *
	 * @returns whether the provider can run.
	 */
	available() {
		return this.options.baseURL.length > 0 && URL.canParse(this.options.baseURL) && this.options.timeoutMs > 0
	}

	/**
	 * Run one query through SearXNG's JSON API.
	 *
	 * @param request - `{ query, maxResults? }` from the seam.
	 * @param signal - optional cancellation forwarded to the HTTP request.
	 * @returns `{ sources, truncated, content? }` for the seam.
	 * @throws {Error} `WEB_ABORTED` when cancelled, `WEB_PROVIDER_ERROR` otherwise.
	 */
	async search(request, signal) {
		const options = this.options
		if (signal?.aborted === true) throw webError('SearXNG search aborted', 'WEB_ABORTED', signal.reason)
		const url = buildSearchUrl(options, request.query)
		const headers = {
			accept: 'application/json',
			'user-agent': options.userAgent,
			...options.headers
		}
		const combined = requestSignal(signal, options.timeoutMs)
		let response
		try {
			response = await fetch(url, {
				method: 'GET',
				headers,
				redirect: 'error',
				signal: combined
			})
		} catch (error) {
			if (signal?.aborted === true) throw webError('SearXNG search aborted', 'WEB_ABORTED', error)
			if (combined.aborted) throw webError(`SearXNG search timed out after ${options.timeoutMs}ms at ${url.origin}${options.apiPath}`, 'WEB_PROVIDER_ERROR', error)
			throw webError(`SearXNG search request to ${url.origin}${options.apiPath} failed: ${String(error)}. Check that the instance is reachable from the DSH host and that \`baseURL\` is correct.`, 'WEB_PROVIDER_ERROR', error)
		}
		if (!response.ok) {
			const detail = await readErrorBody(response)
			throw webError(`SearXNG returned HTTP ${response.status}${detail}.${statusHint(response.status)}`, 'WEB_PROVIDER_ERROR')
		}
		let body
		try {
			body = await response.text()
		} catch (error) {
			if (signal?.aborted === true) throw webError('SearXNG search aborted', 'WEB_ABORTED', error)
			throw webError(`SearXNG response body could not be read from ${url.origin}${options.apiPath}`, 'WEB_PROVIDER_ERROR', error)
		}
		let payload
		try {
			payload = JSON.parse(body)
		} catch (error) {
			const preview = body.replace(/\s+/gu, ' ').trim().slice(0, MAX_ERROR_BODY_CHARS)
			throw webError(`${url.origin}${options.apiPath} did not return SearXNG JSON. Enable the JSON API in SearXNG's settings.yml (\`search: formats: [html, json]\`) and restart SearXNG. Response started with: ${preview || '(empty body)'}`, 'WEB_PROVIDER_ERROR', error)
		}
		if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.results)) {
			throw webError(`${url.origin}${options.apiPath} returned JSON without a results array; this does not look like a SearXNG JSON response`, 'WEB_PROVIDER_ERROR')
		}
		return mapSearxngResponse(payload, request.maxResults ?? options.maxResults)
	}
}

/**
 * Build a provider from one row's config.
 *
 * @param config - the row's raw `config`.
 * @returns the provider instance.
 */
export function createProvider(config) {
	return new SearxngSearchProvider(normalizeConfig(config))
}

/**
 * Register the SearXNG provider with `ctx.web`. The registration is effect
 * scoped, so disabling the row unregisters it again.
 *
 * @param ctx - the plugin context; `inject: ['web']` guarantees `ctx.web`.
 * @param config - this row's `config`.
 */
export function apply(ctx, config) {
	ctx.web.registerSearchProvider(createProvider(config))
}
