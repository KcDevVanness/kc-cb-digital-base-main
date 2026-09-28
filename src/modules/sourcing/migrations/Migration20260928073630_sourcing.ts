import { Migration } from '@mikro-orm/migrations';

export class Migration20260928073630_sourcing extends Migration {

  override name = 'Migration20260928073630';

  override up(): void | Promise<void> {
    this.addSql(`alter table "sourcing_quote_lines" alter column "suggested_rsp" type numeric(18,4) using ("suggested_rsp"::numeric(18,4));`);
    this.addSql(`alter table "sourcing_quote_lines" alter column "unit_cost" type numeric(18,4) using ("unit_cost"::numeric(18,4));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sourcing_quote_lines" alter column "unit_cost" type numeric(18,6) using ("unit_cost"::numeric(18,6));`);
    this.addSql(`alter table "sourcing_quote_lines" alter column "suggested_rsp" type numeric(18,6) using ("suggested_rsp"::numeric(18,6));`);
  }

}
