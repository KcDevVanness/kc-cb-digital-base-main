import { Migration } from '@mikro-orm/migrations';

export class Migration20260928071448_finance extends Migration {

  override name = 'Migration20260928071448';

  override up(): void | Promise<void> {
    this.addSql(`create table "finance_expenses" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "expense_type" text not null, "period_start" date not null, "period_end" date not null, "amount" numeric(18,4) not null, "currency_code" text not null default 'CNY', "exchange_rate" numeric(18,8) null, "channel_id" uuid null, "channel_snapshot" jsonb null, "party_id" uuid null, "party_snapshot" jsonb null, "attachment_id" uuid null, "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "finance_expenses_period_idx" on "finance_expenses" ("tenant_id", "organization_id", "period_start");`);
    this.addSql(`create index "finance_expenses_scope_idx" on "finance_expenses" ("organization_id", "tenant_id");`);
  }

}
