// Midnight's indexer provider imports isomorphic-ws as a namespace. In a
// browser, expose the native WebSocket constructor under both named/default
// exports so its subscriptions use the page's built-in implementation.
const BrowserWebSocket = globalThis.WebSocket;

export const WebSocket = BrowserWebSocket;
export default BrowserWebSocket;
