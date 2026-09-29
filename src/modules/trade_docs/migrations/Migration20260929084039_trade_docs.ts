import { Migration } from '@mikro-orm/migrations';

export class Migration20260929084039_trade_docs extends Migration {

  override name = 'Migration20260929084039';

  override up(): void | Promise<void> {
    this.addSql(`create table "trade_docs_contract_orders" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "contract_id" uuid not null, "order_kind" text not null, "order_id" uuid not null, "order_number" text null, "order_snapshot" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "trade_docs_contract_orders_order_idx" on "trade_docs_contract_orders" ("organization_id", "tenant_id", "order_id");`);
    this.addSql(`create index "trade_docs_contract_orders_scope_idx" on "trade_docs_contract_orders" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "trade_docs_contract_orders" add constraint "trade_docs_contract_orders_contract_order_uniq" unique ("contract_id", "order_kind", "order_id");`);

    this.addSql(`alter table "trade_docs_documents" add "contract_id" uuid null, add "contract_snapshot" jsonb null;`);

    this.addSql(`alter table "trade_docs_contract_orders" add constraint "trade_docs_contract_orders_contract_id_foreign" foreign key ("contract_id") references "trade_docs_contracts" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "trade_docs_documents" drop column "contract_id", drop column "contract_snapshot";`);
    // The generated body only reverses the column adds; the link table has to go too, otherwise a
    // rollback leaves a table nothing writes any more.
    this.addSql(`drop table if exists "trade_docs_contract_orders" cascade;`);
  }

}
