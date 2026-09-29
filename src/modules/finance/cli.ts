import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { emitDueReminders } from './lib/dueReminders'

/**
 * `mercato finance due-reminders --org <organizationId> --tenant <tenantId> [--today YYYY-MM-DD]`
 *
 * Evaluates 逾期未付款 / 逾期未发运 / 库存低于阈值 and raises one notification per condition. It is a
 * command rather than a timer on purpose: this deployment has no scheduler module enabled, and the
 * operator (or their cron) decides when the rules run. Running it twice refreshes the same
 * notifications instead of duplicating them.
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

const dueReminders: ModuleCli = {
  command: 'due-reminders',
  async run(rest) {
    const args = parseArgs(rest)
    const organizationId = args.org ?? args.organizationId
    const tenantId = args.tenant ?? args.tenantId
    if (!organizationId || !tenantId) {
      console.error(
        'Usage: mercato finance due-reminders --org <organizationId> --tenant <tenantId> [--today YYYY-MM-DD]',
      )
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const reminders = await emitDueReminders(
      em,
      { tenantId, organizationId },
      { ...(args.today ? { today: args.today } : {}), resolver: container },
    )
    console.log(`Due reminders: ${reminders.length}`)
    for (const reminder of reminders) {
      console.log(`  [${reminder.kind}] ${reminder.title} — ${reminder.body}`)
    }
  },
}

const cliCommands: ModuleCli[] = [dueReminders]

export default cliCommands
