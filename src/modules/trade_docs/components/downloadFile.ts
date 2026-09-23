import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * Client-side file download for the module's export and generated-document endpoints.
 *
 * Read-shaped: no record is mutated, so this deliberately stays outside the guarded-mutation
 * wrapper. The response is checked against the expected content type before anything is written
 * to the operator's disk — an HTML error page rendered with a 200 must not be saved as an .xlsx.
 */

export function filenameFromDisposition(disposition: string | null, fallback: string): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      // fall through to the quoted/simple form
    }
  }
  const quoted = disposition?.match(/filename="([^"]+)"/i)?.[1]
  return quoted && quoted.trim().length > 0 ? quoted : fallback
}

export async function downloadApiFile(options: {
  url: string
  expectedContentType: string
  fallbackName: string
  errorMessage: string
}): Promise<void> {
  const call = await apiCallOrThrow<Blob>(
    options.url,
    {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'x-om-forbidden-redirect': '0',
        'x-om-unauthorized-redirect': '0',
      },
    },
    { parse: (response) => response.blob(), errorMessage: options.errorMessage },
  )

  const contentType = call.response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (!call.result || contentType !== options.expectedContentType) {
    throw new Error(options.errorMessage)
  }

  const objectUrl = URL.createObjectURL(call.result)
  try {
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filenameFromDisposition(call.response.headers.get('content-disposition'), options.fallbackName)
    document.body.append(link)
    link.click()
    link.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
