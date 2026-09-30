import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { emitOverdueReminders, evaluateOverdueReminders } from './lib/overdueReminders'

/**
 * `mercato export-finance overdue-reminders --org <organizationId> --tenant <tenantId> [--dry-run] [--today YYYY-MM-DD]`
 *
 * Raises the 逾期提醒 for the money that is late: one notification per condition, refreshed rather
 * than duplicated when the same condition is still true (`groupKey` = resource + the day it became
 * late). It is a command, not a timer, exactly like the deployment's other reminders (PRD Q6): the
 * operator or their cron decides when it runs. `--dry-run` prints what would be raised and writes
 * nothing.
 */
function parseArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const value = rest[index + 1]
    if (value && !value.startsWith('--')) {
      args[key] = value
      index += 1
    } else {
      args[key] = 'true'
    }
  }
  return args
}

const overdueReminders: ModuleCli = {
  command: 'overdue-reminders',
  async run(rest) {
    const args = parseArgs(rest)
    const organizationId = args.org ?? args.organizationId
    const tenantId = args.tenant ?? args.tenantId
    if (!organizationId || !tenantId) {
      console.error(
        'Usage: mercato export-finance overdue-reminders --org <organizationId> --tenant <tenantId> [--dry-run] [--today YYYY-MM-DD]',
      )
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const options = {
      ...(args.today ? { today: new Date(`${args.today}T00:00:00.000Z`) } : {}),
      ...(args['dry-run'] ? {} : { resolver: container }),
    }
    const reminders = args['dry-run']
      ? await evaluateOverdueReminders(em, { tenantId, organizationId }, options)
      : await emitOverdueReminders(em, { tenantId, organizationId }, options)

    console.log(`${args['dry-run'] ? 'Overdue reminders (dry run)' : 'Overdue reminders'}: ${reminders.length}`)
    for (const reminder of reminders) {
      console.log(`  [${reminder.kind}] ${reminder.subject} — ${reminder.days} · ${reminder.status}`)
    }
  },
}

const cliCommands: ModuleCli[] = [overdueReminders]

export default cliCommands
