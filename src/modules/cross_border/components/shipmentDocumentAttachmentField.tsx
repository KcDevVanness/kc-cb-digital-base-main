"use client"

import * as React from 'react'
import { Loader2, Upload } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AttachmentPreviewLink } from '@/lib/attachments/AttachmentPreview'
import { SHIPMENT_ATTACHMENT_ENTITY_ID, shipmentErrorMessage } from './ShipmentForm'

/**
 * The upload control for an export document's file. It talks to the shared attachments endpoint
 * (`POST /api/attachments`, multipart) exactly as the installed attachment surfaces do, and hands
 * the returned id back to the form — the document command stores that id, never a byte of file.
 *
 * The owning shipment is the attachment's `recordId`, because documents hang on the shipment
 * (REQ-CB-007). Two callers need two shapes of the same field:
 *
 * - the shipment detail's document dialog knows its shipment (`shipmentId: string`);
 * - the packing-list ledger picks the shipment in the same form, so the id is read from the live
 *   values on every render (`shipmentId: (values) => …`).
 *
 * With no shipment yet there is nowhere to file the bytes, so the control renders disabled with a
 * hint instead of uploading a file no document can point at.
 */
export type ShipmentDocumentAttachmentFieldProps = CrudCustomFieldRenderProps & {
  shipmentId: string | ((values: Record<string, unknown> | undefined) => string)
}

export function ShipmentDocumentAttachmentField({
  value,
  setValue,
  disabled,
  shipmentId,
  values,
}: ShipmentDocumentAttachmentFieldProps) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const attachmentId = typeof value === 'string' ? value : ''
  const resolvedShipmentId = typeof shipmentId === 'function' ? shipmentId(values) : shipmentId

  const acceptFile = React.useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (!file || !resolvedShipmentId) return
    setError(null)
    setIsUploading(true)
    try {
      const body = new FormData()
      body.set('entityId', SHIPMENT_ATTACHMENT_ENTITY_ID)
      body.set('recordId', resolvedShipmentId)
      body.set('file', file)
      const call = await apiCall<{ item?: { id?: string }; error?: string }>(
        '/api/attachments',
        { method: 'POST', body },
        { fallback: null },
      )
      const uploadedId = call.ok && typeof call.result?.item?.id === 'string' ? call.result.item.id : ''
      if (!uploadedId) {
        throw new Error(call.result?.error || t('cross_border.shipments.documents.saveFailed'))
      }
      setValue(uploadedId)
      setFileName(file.name)
    } catch (cause) {
      setError(shipmentErrorMessage(cause, t('cross_border.shipments.documents.saveFailed')))
    } finally {
      setIsUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [resolvedShipmentId, setValue, t])

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || isUploading || !resolvedShipmentId}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
          {t('cross_border.shipments.documents.field.attachment')}
        </Button>
        {attachmentId ? (
          <>
            <AttachmentPreviewLink
              attachmentId={attachmentId}
              fileName={fileName}
              label={t('cross_border.shipments.documents.preview')}
            />
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setValue('')
                setFileName(null)
              }}
            >
              {t('cross_border.shipments.documents.remove')}
            </Button>
          </>
        ) : null}
      </div>
      {!resolvedShipmentId ? (
        <p className="text-xs text-muted-foreground">{t('cross_border.packingLists.form.attachmentNeedsShipment')}</p>
      ) : null}
      {fileName ? <p className="text-xs text-muted-foreground">{fileName}</p> : null}
      {error ? <p className="text-xs font-medium text-status-error-text" role="alert">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => { void acceptFile(event.target.files) }}
      />
    </div>
  )
}
