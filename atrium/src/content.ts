/** Proposal decks served by the Atrium content API to signed-in users. */
export type ContentId = 'proposal' | 'exec'

export class ContentError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`content ${status}`)
    this.status = status
  }
}

export async function fetchContent(apiUrl: string, id: ContentId, token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${apiUrl}/content/${id}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (!res.ok) throw new ContentError(res.status)
  return res.text()
}
