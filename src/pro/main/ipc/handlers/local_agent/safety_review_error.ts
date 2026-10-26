/** Project provider failures to fixed messages. Never expose bodies, URLs or keys. */
export function describeSafetyReviewFailure(error: unknown): string {
  const seen = new Set<unknown>();
  const queue = [error];
  let transport = false;
  let protocol = false;
  while (queue.length && seen.size < 12) {
    const next = queue.shift();
    if (!next || typeof next !== "object" || seen.has(next)) continue;
    seen.add(next);
    const record = next as {
      statusCode?: unknown;
      cause?: unknown;
      errors?: unknown;
      name?: unknown;
      message?: unknown;
      code?: unknown;
      error?: unknown;
    };
    const status = record.statusCode;
    const code = typeof record.code === "string" ? record.code : "";
    if (
      /^(?:invalid_api_key|authentication_error|permission_denied)$/.test(code)
    )
      return "The review provider reported an authentication or permission error. Check its API key and model access.";
    if (
      /^(?:rate_limit_exceeded|rate_limit_error|insufficient_quota)$/.test(code)
    )
      return "The review provider reported a rate limit or insufficient quota. Check its account and retry later.";
    if (
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
    ) {
      const advice =
        status === 401 || status === 403
          ? "Check the review provider's API key and model access."
          : status === 404
            ? "Check the review provider's base URL and model ID."
            : status === 429
              ? "The review provider is rate-limiting or has insufficient quota; check its account and retry later."
              : status === 400 || status === 422
                ? "The provider rejected the review request; check model/tool-call support and model settings."
                : status >= 500
                  ? "The review provider is unavailable; retry later or choose another review model."
                  : "Check the review provider configuration.";
      return `Review model request failed (HTTP ${status}). ${advice}`;
    }
    // Classify locally; these strings are never echoed to users or logs.
    const message =
      typeof record.message === "string" ? record.message.slice(0, 4096) : "";
    transport ||=
      /fetch failed|network|econn|enotfound|socket|tls|certificate/i.test(
        message,
      );
    protocol ||=
      /AI_(?:TypeValidation|UnsupportedFunctionality|InvalidResponseData|NoOutputGenerated)Error/.test(
        String(record.name),
      );
    if (record.cause) queue.push(record.cause);
    if (record.error) queue.push(record.error);
    if (Array.isArray(record.errors)) queue.push(...record.errors.slice(0, 6));
  }
  if (transport)
    return "Could not reach the review provider. Check its endpoint, network, proxy and TLS settings.";
  if (protocol)
    return "The review provider returned no usable output or an incompatible response. Choose a model that supports streaming tool calls and text verdicts.";
  return "The review model could not complete the request. Check the review provider or select a different review model.";
}
