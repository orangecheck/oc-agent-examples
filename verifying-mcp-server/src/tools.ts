// Toy tool dispatcher. Replace in your own integration.
//
// The point of this example is the verify-then-dispatch flow in index.ts —
// these handlers are stubs that return deterministic mock data so the demo
// runs without any network calls.

interface ToolHandler {
    (args: Record<string, unknown>): Promise<unknown>;
}

export const TOOLS: Record<string, ToolHandler> = {
    /**
     * `search` — returns a fixed list of mock hits keyed by the query.
     */
    search: async (args) => {
        const query = String(args.query ?? '');
        const limit = Number(args.limit ?? 5);
        return {
            query,
            hits: Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
                title: `Mock hit ${i + 1} for ${JSON.stringify(query)}`,
                url: `https://example.test/result/${i + 1}`,
                snippet: 'Replace this with a real backend in your integration.',
            })),
        };
    },

    /**
     * `echo` — diagnostic; returns the arguments verbatim.
     */
    echo: async (args) => ({ echoed: args }),
};

export function listTools(): string[] {
    return Object.keys(TOOLS);
}

export async function dispatchTool(
    name: string,
    args: Record<string, unknown>
): Promise<unknown> {
    const handler = TOOLS[name];
    if (!handler) {
        throw new Error(`unknown tool: ${name} (available: ${listTools().join(', ')})`);
    }
    return handler(args);
}
