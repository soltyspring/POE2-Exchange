/** Keep a hung upstream request from leaving a permanent loading state. */
export async function request(url: string, options: RequestInit = {}, timeoutMs = 20_000): Promise<Response> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener('abort', abort, {once: true})
  const timer = setTimeout(abort, timeoutMs)
  try {
    const response = await fetch(url, {...options, signal: controller.signal})
    // Keep the timeout alive while JSON bytes arrive, not just until headers arrive.
    const body = [204, 205, 304].includes(response.status) ? null : await response.arrayBuffer()
    return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers})
  }
  catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error('응답이 늦어지고 있습니다. 잠시 후 다시 확인해 주세요.')
    throw error
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
}
