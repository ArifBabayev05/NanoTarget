// SPDX-License-Identifier: BUSL-1.1
export default class WebSocketUnavailable { constructor() { throw new Error("WebSocket transport disabled; use https:// libsql URLs"); } }
export const WebSocket = WebSocketUnavailable;
