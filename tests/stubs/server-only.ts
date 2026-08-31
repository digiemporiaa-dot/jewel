/**
 * `server-only` under the test runner.
 *
 * The real package throws on import outside a React Server Component, which
 * would put every server module — the order and cart code included — out of
 * reach of the suite. The guard it provides is a build-time one about where
 * code may be bundled; it has nothing to say about a Node test process, so it
 * is stubbed out here rather than worked around by duplicating the code under
 * test.
 */
export {};
